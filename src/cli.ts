import { spawn, spawnSync, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync, mkdirSync, writeFileSync, readFileSync, unlinkSync } from 'node:fs';
import readline from 'node:readline';
import { loadConfig, saveConfig, CONFIG_FILE } from './config/index.js';
import { buildSession, attachOrExec, killSession, sessionExists } from './tmux/session.js';
import { STATE_DIR } from './ipc/state.js';
import { checkDeps } from './preflight.js';
import { autoInstall, runAuth } from './installer.js';
import { checkLatestVersion, runUpgrade } from './update-check.js';
import { ensureProductHubClone } from './product-hub/locate.js';

const here = dirname(fileURLToPath(import.meta.url));
const DAEMON_ENTRY = join(here, 'daemon.ts');
const PID_FILE = join(STATE_DIR, 'daemon.pid');

const PKG_JSON = join(here, '..', 'package.json');
const readVersion = (): string => {
  try {
    return (JSON.parse(readFileSync(PKG_JSON, 'utf8')) as { version: string }).version;
  } catch { return '0.0.0'; }
};

const usage = () => {
  console.log(`zax-shell ${readVersion()} — ZAX cockpit (Jira × product-hub × Claude Code)

USAGE
  zax-shell              Start (or attach to) the cockpit
  zax-shell --kill       Kill the tmux session and stop the daemon
  zax-shell --status     Show daemon and tmux session status
  zax-shell --config     Print the active config path
  zax-shell --set k=v    Set a config key (e.g. productHubPath=/path)
  zax-shell --jira-debug Diagnose acli connection (version, auth, sample query)
  zax-shell --version    Print version
  zax-shell --help       Show this help

CONFIG
  ${CONFIG_FILE}
`);
};

const printStatus = () => {
  const cfg = loadConfig();
  const deps = checkDeps();
  console.log('zax-shell status');
  for (const d of deps) {
    console.log(`  ${d.installed ? '✓' : '✗'} ${d.name.padEnd(6)} ${d.installed ? (d.version ?? '') : '(missing)'}`);
  }
  console.log('  session "zax": ', sessionExists(cfg.tmuxSession) ? 'running' : '(none)');
  console.log('  productHubPath:', cfg.productHubPath, existsSync(cfg.productHubPath) ? '(exists)' : '(missing)');
  console.log('  config file:  ', CONFIG_FILE);
  console.log('  daemon pid:   ', daemonPid() ?? '(none)');
};

/** Returns the PID of a running daemon, or null. */
const daemonPid = (): number | null => {
  if (!existsSync(PID_FILE)) return null;
  try {
    const pid = parseInt(readFileSync(PID_FILE, 'utf8').trim(), 10);
    if (!Number.isFinite(pid)) return null;
    process.kill(pid, 0);   // throws ESRCH if dead
    return pid;
  } catch {
    try { unlinkSync(PID_FILE); } catch {}
    return null;
  }
};

const startDaemon = (): void => {
  if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true });
  const existing = daemonPid();
  if (existing) {
    console.log(`zax: daemon already running (pid ${existing}) — reusing`);
    return;
  }
  const child = spawn(
    'node',
    ['--import', 'tsx', DAEMON_ENTRY],
    { detached: true, stdio: ['ignore', 'ignore', 'ignore'], env: process.env },
  );
  if (child.pid) writeFileSync(PID_FILE, String(child.pid), 'utf8');
  child.unref();
};

const killDaemon = (): void => {
  const pid = daemonPid();
  if (pid) {
    try { process.kill(pid, 'SIGTERM'); } catch {}
    try { unlinkSync(PID_FILE); } catch {}
  }
};

/** Build the bash command that runs in the right pane until an epic is picked. */
const buildIdleCommand = (productHubPath: string): string => {
  const banner = [
    '',
    '   ┌────────────────────────────────────────────┐',
    '   │              \x1b[36;1mZ A X   S H E L L\x1b[0m              │',
    '   │   Jira  ·  product-hub  ·  Claude Code     │',
    '   └────────────────────────────────────────────┘',
    '',
    '   👈  좌측 \x1b[36;1mEpics\x1b[0m 패널에서 에픽을 선택하세요.',
    '       선택하면 이 자리에 \x1b[33mclaude\x1b[0m 가 자동으로 실행됩니다.',
    '',
    '   product-hub: \x1b[2m' + productHubPath + '\x1b[0m',
    '',
    '   주요 단축키',
    '     · \x1b[36mCtrl-T\x1b[0m      pane 순환 (Epics → Hub → Claude)',
    '     · \x1b[36m?\x1b[0m           전체 도움말',
    '     · \x1b[36m/\x1b[0m           Epics 필터',
    '     · \x1b[36mEnter\x1b[0m       에픽/아티팩트 열기',
    '     · \x1b[36mq\x1b[0m           종료 확인 팝업',
    '     · 마우스 클릭으로 패널 포커스도 됨',
    '',
  ].join('\n');
  const safe = banner.replace(/'/g, "'\\''");
  return `bash -lc 'printf "%s\\n" '\\''${safe}'\\''; exec bash'`;
};

const killAll = (): void => {
  killDaemon();
  try { execSync('pkill -9 -f "src/daemon.ts"', { stdio: 'ignore' }); } catch {}
  try { execSync('pkill -9 -f "dist/daemon"', { stdio: 'ignore' }); } catch {}
};

const askYesNo = (q: string, defaultYes = true): Promise<boolean> =>
  new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(`${q} ${defaultYes ? '[Y/n]' : '[y/N]'} `, (ans) => {
      rl.close();
      const t = ans.trim();
      if (!t) return resolve(defaultYes);
      resolve(/^y/i.test(t));
    });
  });

const promptUpdateAndMaybeUpgrade = async (): Promise<void> => {
  // Recursion guard: after self-restart we set this env var so the new
  // process skips the check (cache already up to date anyway).
  if (process.env.ZAX_SHELL_SKIP_UPDATE_CHECK) return;

  const current = readVersion();
  let info;
  try { info = checkLatestVersion(current); } catch { return; }
  if (!info || !info.hasUpdate) return;

  console.error('');
  console.error(`  📦 새 버전: zax-shell ${info.latest} (현재 ${info.current})`);
  const proceed = await askYesNo('  지금 업데이트하시겠어요?', true);
  if (!proceed) return;

  const installDir = join(here, '..');  // repo root (dist/cli.js → ../package.json)
  console.error('');
  const result = runUpgrade(installDir);
  if (!result.ok) {
    console.error(`  ✗ ${result.message} — 계속 진행합니다 (현재 버전 유지)`);
    return;
  }
  console.error(`  ✓ ${result.message} — 재시작합니다.\n`);

  // Replace this process with the upgraded launcher. The env flag stops
  // the recursive check in the new process.
  const launcher = join(installDir, 'bin', 'zax-shell');
  const r = spawnSync(launcher, process.argv.slice(2), {
    stdio: 'inherit',
    env: { ...process.env, ZAX_SHELL_SKIP_UPDATE_CHECK: '1' },
  });
  process.exit(r.status ?? 0);
};

const main = async () => {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) { usage(); return; }
  if (args.includes('--version') || args.includes('-v')) {
    console.log(readVersion());
    return;
  }
  if (args.includes('--status')) { printStatus(); return; }
  if (args.includes('--config')) { console.log(CONFIG_FILE); return; }

  if (args.includes('--jira-debug')) {
    const { jiraCliDebug } = await import('./jira/cli.js');
    const r = await jiraCliDebug();
    const tick = (ok: boolean) => ok ? '✓' : '✗';
    console.log(`${tick(true)}        version: ${r.version}`);
    console.log(`${tick(r.auth.ok)}           auth: ${r.auth.message.split('\n')[0]}`);
    if (r.sample.ok) {
      console.log(`${tick(true)}   sample query: ${r.sample.count} epic(s) returned`);
    } else {
      console.log(`${tick(false)}   sample query: ${r.sample.error}`);
    }
    if (!r.auth.ok) {
      console.log('\nNext step:  acli auth login');
    }
    process.exit(r.auth.ok && r.sample.ok ? 0 : 1);
  }

  if (args.includes('--kill')) {
    const cfg = loadConfig();
    killSession(cfg.tmuxSession);
    killDaemon();
    console.log('zax: tmux session + daemon stopped');
    return;
  }

  if (args.includes('--kill-all')) {
    const cfg = loadConfig();
    killSession(cfg.tmuxSession);
    killAll();
    console.log('zax: killed tmux + daemon (and any orphaned daemon processes)');
    return;
  }

  const setIdx = args.findIndex((a) => a === '--set');
  if (setIdx !== -1 && args[setIdx + 1]) {
    const [k, ...rest] = args[setIdx + 1]!.split('=');
    const v = rest.join('=');
    if (!k || v === undefined) { console.error('Use --set key=value'); process.exit(1); }
    const saved = saveConfig({ [k]: v } as any);
    console.log(`saved: ${k}=${(saved as any)[k]}`);
    return;
  }

  // Check for a newer release before doing anything heavy. Skips silently
  // if gh isn't authed yet or no network.
  await promptUpdateAndMaybeUpgrade();

  // Always call autoInstall: it also catches "binary present but unconfigured"
  // (jira-cli without `jira init`) which a missing-check alone would skip.
  let deps = checkDeps();
  const initiallyMissing = deps.some((d) => !d.installed);
  const r = await autoInstall(deps);
  if (!r.ok) process.exit(2);
  if (r.needsAuth.length > 0) await runAuth(r.needsAuth);
  if (initiallyMissing) {
    deps = checkDeps();
    const stillMissing = deps.filter((d) => d.required && !d.installed);
    if (stillMissing.length > 0) {
      console.error('\n필수 도구가 여전히 설치되지 않았습니다. 다시 실행해 주세요.');
      process.exit(2);
    }
  }

  const cfg = loadConfig();

  // Ensure zax-shell's own product-hub clone exists. Default location is
  // ~/.cache/zax-shell/repo; user can override via --set productHubPath=<path>
  // if they want zax-shell to reuse an existing checkout.
  if (!ensureProductHubClone(cfg.productHubPath)) {
    process.exit(2);
  }

  startDaemon();

  // Small grace period so the daemon writes state.json before panes read.
  await new Promise((r) => setTimeout(r, 250));

  if (!sessionExists(cfg.tmuxSession)) {
    // Wipe any saved tmux layout from previous builds — restoring a stale
    // layout (e.g. from before we removed spacer panes) breaks the freshly
    // built 4-pane geometry.
    try {
      const { savePrefs } = await import('./ipc/ui-prefs.js');
      savePrefs({ tmuxLayout: undefined });
    } catch {}

    const idleCmd = buildIdleCommand(cfg.productHubPath);
    buildSession({
      sessionName: cfg.tmuxSession,
      productHubPath: cfg.productHubPath,
      rightPaneIdle: idleCmd,
    });
  }

  attachOrExec(cfg.tmuxSession);
};

main().catch((err) => {
  console.error('zax-shell error:', err);
  process.exit(1);
});
