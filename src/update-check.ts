import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { STATE_DIR } from './ipc/state.js';

const REPO = 'jhso-dev/zax-shell';
const CACHE_FILE = join(STATE_DIR, 'update-check.json');
const CHECK_TTL_MS = 12 * 60 * 60 * 1000;

interface Cache {
  lastCheckedAt: number;
  latestVersion: string | null;
}

const readCache = (): Cache => {
  try { return JSON.parse(readFileSync(CACHE_FILE, 'utf8')) as Cache; }
  catch { return { lastCheckedAt: 0, latestVersion: null }; }
};

const writeCache = (c: Cache) => {
  if (!existsSync(dirname(CACHE_FILE))) mkdirSync(dirname(CACHE_FILE), { recursive: true });
  writeFileSync(CACHE_FILE, JSON.stringify(c, null, 2), 'utf8');
};

// Uses gh CLI (already a hard dep) so this works on private repos too.
// Returns null on any failure — update check should never break startup.
const fetchLatestVersion = (): string | null => {
  try {
    const out = execFileSync(
      'gh', ['api', `repos/${REPO}/releases/latest`, '--jq', '.tag_name'],
      { stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 },
    ).toString().trim();
    return out.replace(/^v/, '') || null;
  } catch { return null; }
};

export interface UpdateInfo {
  current: string;
  latest: string;
  hasUpdate: boolean;
}

export function checkLatestVersion(currentVersion: string): UpdateInfo | null {
  const cache = readCache();
  const stale = Date.now() - cache.lastCheckedAt > CHECK_TTL_MS;

  let latest = cache.latestVersion;
  if (stale || !latest) {
    const fetched = fetchLatestVersion();
    if (fetched) {
      latest = fetched;
      writeCache({ lastCheckedAt: Date.now(), latestVersion: fetched });
    } else if (!latest) {
      return null;
    }
  }
  if (!latest) return null;

  return {
    current: currentVersion,
    latest,
    hasUpdate: compareVersions(latest, currentVersion) > 0,
  };
}

// Returns positive if a > b, negative if a < b, 0 if equal.
// Handles plain semver (1.2.3), ignores pre-release suffixes.
function compareVersions(a: string, b: string): number {
  const parse = (s: string) => s.replace(/^v/, '').split(/[-+]/, 1)[0]!.split('.').map((n) => parseInt(n, 10) || 0);
  const ap = parse(a), bp = parse(b);
  for (let i = 0; i < Math.max(ap.length, bp.length); i++) {
    const d = (ap[i] ?? 0) - (bp[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

export interface UpgradeResult {
  ok: boolean;
  message: string;
}

export function runUpgrade(installDir: string): UpgradeResult {
  const run = (cmd: string, args: string[]) =>
    spawnSync(cmd, args, { cwd: installDir, stdio: 'inherit' });

  const pull = run('git', ['pull', '--ff-only', '--quiet', 'origin']);
  if (pull.status !== 0) {
    return { ok: false, message: 'git pull 실패 (수동으로 처리 필요)' };
  }
  const ci = run('npm', ['ci', '--silent']);
  if (ci.status !== 0) return { ok: false, message: 'npm ci 실패' };
  const build = run('npm', ['run', 'build', '--silent']);
  if (build.status !== 0) return { ok: false, message: 'npm run build 실패' };

  return { ok: true, message: '업데이트 완료' };
}

export function clearUpdateCache(): void {
  writeCache({ lastCheckedAt: 0, latestVersion: null });
}
