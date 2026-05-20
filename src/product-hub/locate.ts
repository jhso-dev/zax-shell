import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

const ORG_REPO = 'zigbang/product-hub';
// "product-codex" is product-hub's old name — GitHub still serves it via
// redirect, so legacy clones often have origin pointing there.
const REMOTE_PATTERN = /[/:]zigbang\/(product-hub|product-codex)(\.git)?$/;

function originMatches(cloneDir: string): boolean {
  try {
    const url = execFileSync('git', ['-C', cloneDir, 'remote', 'get-url', 'origin'], {
      stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000,
    }).toString().trim();
    return REMOTE_PATTERN.test(url);
  } catch { return false; }
}

/**
 * Make sure a product-hub clone exists at the given path. zax-shell owns
 * this clone — it's stored under ~/.cache/zax-shell/repo by default so the
 * user's own working copy (wherever they keep it) is never touched.
 */
export function ensureProductHubClone(cloneDir: string): boolean {
  if (existsSync(join(cloneDir, '.git'))) {
    if (originMatches(cloneDir)) return true;
    console.error(`✗ ${cloneDir} 는 product-hub 클론이 아닙니다.`);
    console.error('  해당 디렉토리를 비우거나 --set productHubPath=<경로>로 변경하세요.');
    return false;
  }

  console.error('');
  console.error(`▶ product-hub 클론 → ${cloneDir}`);
  console.error('  (zax-shell 전용 클론입니다. 기존 product-hub 워킹 트리는 영향 없음)');
  mkdirSync(dirname(cloneDir), { recursive: true });
  const r = spawnSync('gh', ['repo', 'clone', ORG_REPO, cloneDir], { stdio: 'inherit' });
  if (r.status !== 0) {
    console.error('✗ 클론 실패. `gh auth login` 상태와 zigbang 조직 권한을 확인하세요.');
    return false;
  }
  return true;
}
