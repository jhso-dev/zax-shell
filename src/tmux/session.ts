import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { STATE_DIR } from '../ipc/state.js';

const here = dirname(fileURLToPath(import.meta.url));
const PANE_ENTRY = join(here, '..', 'pane.tsx');
const NODE_BIN = process.execPath;

/**
 * Build the command tmux runs for a side pane. We invoke node directly with
 * the tsx loader so there's no wrapper process competing for stdin — that
 * matters because Ink's `useInput` puts stdin into raw mode and a double-
 * process chain breaks key forwarding (arrow keys stop working).
 */
const paneCmd = (paneName: 'dashboard' | 'epics' | 'artifacts'): string => {
  // Shell-quote each piece because tmux runs this through a shell.
  const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
  return `${q(NODE_BIN)} --import tsx ${q(PANE_ENTRY)} --pane=${paneName}`;
};

const RIGHT_PANE_FILE = join(STATE_DIR, 'right-pane-id');
const LABELS_FILE = join(STATE_DIR, 'pane-labels.json');

interface PaneLabels {
  dashboard: string;
  epics: string;
  right: string;
  artifacts: string;
}

const PANE_TITLES: Record<keyof PaneLabels, string> = {
  dashboard: 'Dashboard',
  epics: 'Epics  (↑↓ Enter · / 검색 · ? 도움말)',
  right: 'Claude Code',
  artifacts: 'Product-Hub',
};

function saveLabels(targets: PaneLabels): void {
  if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(LABELS_FILE, JSON.stringify(targets), 'utf8');
}

function loadLabels(): PaneLabels | null {
  try { return JSON.parse(readFileSync(LABELS_FILE, 'utf8')) as PaneLabels; }
  catch { return null; }
}

/** Re-apply pane titles. Idempotent — safe to call repeatedly. */
export function applyPaneLabels(): void {
  const labels = loadLabels();
  if (!labels) return;
  for (const k of Object.keys(PANE_TITLES) as (keyof PaneLabels)[]) {
    tmuxQuiet(['select-pane', '-t', labels[k], '-T', PANE_TITLES[k]]);
  }
}

const tmux = (args: string[]): string =>
  execFileSync('tmux', args, { stdio: ['ignore', 'pipe', 'pipe'] }).toString();

const tmuxQuiet = (args: string[]): void => { try { tmux(args); } catch {} };

export function sessionExists(name: string): boolean {
  try { tmux(['has-session', '-t', name]); return true; } catch { return false; }
}

const saveRightPaneId = (id: string) => {
  if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(RIGHT_PANE_FILE, id, 'utf8');
};

const loadRightPaneId = (): string | null => {
  try {
    const v = readFileSync(RIGHT_PANE_FILE, 'utf8').trim();
    return v.length > 0 ? v : null;
  } catch { return null; }
};

const splitWindowReturningPaneId = (args: string[]): string => {
  const out = tmux(['split-window', '-P', '-F', '#{pane_id}', ...args]).trim();
  return out.split('\n').pop()!.trim();
};

export interface BuildOpts {
  sessionName: string;
  productHubPath: string;
  /** Right pane command when no epic selected. */
  rightPaneIdle: string;
}

/**
 * Layout:
 *   ┌──── dashboard (3 rows) ────┐
 *   │ epics    │ right pane      │
 *   ├──────────┤ (claude/idle)   │
 *   │ artifacts│                 │
 *   └──────────┴─────────────────┘
 */
export function buildSession(opts: BuildOpts): void {
  const { sessionName, productHubPath, rightPaneIdle } = opts;
  if (sessionExists(sessionName)) return;

  const env: NodeJS.ProcessEnv = { ...process.env, ZAX_SHELL_PRODUCT_HUB: productHubPath };

  execFileSync('tmux', [
    'new-session', '-d', '-s', sessionName, '-n', 'cockpit',
    '-x', '240', '-y', '60',
    paneCmd('dashboard'),
  ], { env, stdio: 'ignore' });

  tmux(['split-window', '-t', `${sessionName}:0.0`, '-v', '-l', '85%',
        paneCmd('epics')]);

  // Right column (Claude) gets 55% — side panels need >=45% for epic titles.
  const rightPaneId = splitWindowReturningPaneId([
    '-t', `${sessionName}:0.1`, '-h', '-l', '55%', rightPaneIdle,
  ]);
  saveRightPaneId(rightPaneId);

  const artifactsPaneId = splitWindowReturningPaneId([
    '-t', `${sessionName}:0.1`, '-v', '-l', '55%', paneCmd('artifacts'),
  ]);

  tmuxQuiet(['resize-pane', '-t', `${sessionName}:0.0`, '-y', '3']);
  tmuxQuiet(['select-pane', '-t', `${sessionName}:0.1`]);
  tmuxQuiet(['set-option', '-t', sessionName, 'status', 'off']);

  // Mouse + no-prefix navigation: avoids the "arrow keys don't work because
  // tmux focus is on the wrong pane" trap.
  tmuxQuiet(['set-option', '-t', sessionName, 'mouse', 'on']);

  // Prevent the default mouse behaviors that enter copy-mode — once in copy
  // mode, arrows move the selection cursor instead of reaching our Ink panes.
  tmuxQuiet(['unbind-key', '-T', 'root', 'MouseDrag1Pane']);
  tmuxQuiet(['unbind-key', '-T', 'root', 'DoubleClick1Pane']);
  tmuxQuiet(['unbind-key', '-T', 'root', 'TripleClick1Pane']);
  tmuxQuiet(['bind-key', '-T', 'root', 'WheelUpPane',
             'select-pane -t = ; send-keys -t = Up']);
  tmuxQuiet(['bind-key', '-T', 'root', 'WheelDownPane',
             'select-pane -t = ; send-keys -t = Down']);

  applyNavBindings(sessionName, rightPaneId, artifactsPaneId);

  tmuxQuiet(['set-option', '-t', sessionName, 'pane-border-style', 'fg=colour240']);
  tmuxQuiet(['set-option', '-t', sessionName, 'pane-active-border-style', 'fg=colour51,bold']);
  tmuxQuiet(['set-option', '-t', sessionName, 'pane-border-status', 'top']);
  tmuxQuiet(['set-option', '-t', sessionName, 'pane-border-format',
             ' #{?pane_active,#[fg=colour51 bold],#[fg=colour244]} #{pane_title} ']);

  // Persist the labels in a file so the daemon (which outlives the brief
  // cli.ts process) can re-apply them. The shell that wraps each split
  // command emits an OSC-2 sequence during startup that resets pane_title
  // to the hostname; re-setting after a short delay overrides that.
  saveLabels({
    dashboard: `${sessionName}:0.0`,
    epics: `${sessionName}:0.1`,
    right: rightPaneId,
    artifacts: artifactsPaneId,
  });
  applyPaneLabels();

  tmuxQuiet(['select-pane', '-t', `${sessionName}:0.1`]);
}

export function getRightPaneId(): string | null {
  return loadRightPaneId();
}

export function respawnRightPane(_sessionName: string, cwd: string, cmd: string): boolean {
  const paneId = loadRightPaneId();
  if (!paneId) return false;
  try {
    tmux(['respawn-pane', '-k', '-c', cwd, '-t', paneId, cmd]);
    return true;
  } catch {
    return false;
  }
}

/** Drop a message into the right pane (idle / folder-missing notice). */
export function notifyRightPane(message: string): boolean {
  const paneId = loadRightPaneId();
  if (!paneId) return false;
  try {
    const safe = message.replace(/'/g, "'\\''");
    tmux(['respawn-pane', '-k', '-t', paneId,
          `bash -lc 'echo "${safe}"; exec bash'`]);
    return true;
  } catch { return false; }
}

export function attachOrExec(sessionName: string): void {
  if (process.env.TMUX) {
    const child = spawn('tmux', ['switch-client', '-t', sessionName], { stdio: 'inherit' });
    child.on('exit', (code) => process.exit(code ?? 0));
    return;
  }
  const child = spawn('tmux', ['attach', '-t', sessionName], {
    stdio: 'inherit', env: process.env,
  });
  child.on('exit', (code) => process.exit(code ?? 0));
}

export function killSession(sessionName: string): void {
  tmuxQuiet(['kill-session', '-t', sessionName]);
}

/**
 * Render a centered, modal-style confirmation popup floating above the
 * cockpit. Resolves true (kill confirmed) / false (cancelled). The popup
 * grabs focus until the user picks Y / Enter (yes) or N / Esc (no).
 */
function withSuspendedNav<T>(spawnPopup: () => Promise<T>): Promise<T> {
  suspendNavBindings();
  return spawnPopup().finally(() => resumeNavBindings());
}

export function showQuitConfirm(): Promise<boolean> {
  const promptScript = `
const out = process.stdout;
const inp = process.stdin;
inp.setRawMode(true);
inp.resume();
out.write('\\x1b[?25l');                          // hide cursor
const restore = () => out.write('\\x1b[?25h');    // show cursor on exit
process.on('exit', restore);
const lines = [
  '',
  '   \\x1b[1;91m▌ zax-shell 을 종료하시겠습니까?\\x1b[0m',
  '',
  '   \\x1b[1mY\\x1b[0m / \\x1b[1mEnter\\x1b[0m  →  확인',
  '   \\x1b[1mN\\x1b[0m / \\x1b[1mEsc\\x1b[0m    →  취소',
  '',
];
out.write(lines.join('\\n'));
inp.on('data', (d) => {
  const ch = d.toString();
  if (ch === 'y' || ch === 'Y' || ch === '\\r' || ch === '\\n') process.exit(0);
  if (ch === 'n' || ch === 'N' || ch === '\\x1b' || ch === '\\x03') process.exit(1);
});
`.trim();

  return withSuspendedNav(() => new Promise<boolean>((resolve) => {
    const args = [
      'display-popup', '-E',
      '-w', '54', '-h', '9',
      '-S', 'fg=red,bold',
      '-T', ' zax-shell ',
      process.execPath, '-e', promptScript,
    ];
    const child = spawn('tmux', args, { stdio: 'inherit' });
    child.on('exit', (code) => resolve(code === 0));
    child.on('error', () => resolve(false));
  }));
}

/** Capture the current tmux layout string for a window. */
export function captureLayout(sessionName: string): string | null {
  try {
    const out = tmux(['list-windows', '-t', sessionName,
                      '-F', '#{window_layout}']).trim().split('\n')[0]!;
    return out || null;
  } catch { return null; }
}

export function showHelpPopup(): Promise<void> {
  const helpEntry = join(here, '..', 'help-popup.ts');
  return withSuspendedNav(() => new Promise<void>((resolve) => {
    const child = spawn('tmux', [
      'display-popup', '-E',
      '-w', '80', '-h', '32',
      '-S', 'fg=cyan,bold',
      '-T', ' zax-shell help ',
      process.execPath, '--import', 'tsx', helpEntry,
    ], { stdio: 'inherit' });
    child.on('exit', () => resolve());
    child.on('error', () => resolve());
  }));
}

/** Same rationale as showGhDashPopup — new window, not popup, for stability. */
export function showJiraDetailPopup(epicKey: string): Promise<void> {
  return new Promise((resolve) => {
    const shellCmd = `jira issue view ${shellQuote(epicKey)}; ` +
                     `echo; echo '(아무 키나 누르면 창이 닫힙니다)'; read -n1`;
    try {
      execFileSync('tmux', [
        'new-window', '-n', `jira · ${epicKey}`,
        'bash', '-lc', shellCmd,
      ], { stdio: 'ignore' });
    } catch { /* ignore */ }
    resolve();
  });
}

/**
 * gh-dash opens in a new tmux window (not a popup) for stability. A popup
 * closes the moment its embedded command exits, so any stray keystroke that
 * gh-dash interprets as quit would visually "kill the popup" — confusing
 * UX. A window survives gh-dash quitting and the user closes it explicitly.
 * Switch back to the cockpit window with `Ctrl-B 0` (or click any pane).
 */
export function showGhDashPopup(epicKey: string, configPath: string,
                                cwd: string): Promise<void> {
  return new Promise((resolve) => {
    const shellCmd = `cd ${shellQuote(cwd)} && gh dash --config ${shellQuote(configPath)}; ` +
                     `echo; echo '(gh-dash 종료됨. 아무 키나 누르면 창이 닫힙니다)'; read -n1`;
    try {
      execFileSync('tmux', [
        'new-window', '-n', `gh · ${epicKey}`,
        'bash', '-lc', shellCmd,
      ], { stdio: 'ignore' });
    } catch { /* ignore */ }
    resolve();
  });
}

function shellQuote(s: string): string { return `'${s.replace(/'/g, `'\\''`)}'`; }

// ── pane navigation bindings ──────────────────────────────────────────────
// Tab / Ctrl-T / Alt-* cycle and resize panes. While a popup is open we
// must *unbind* them so the embedded tool (gh-dash, jira-cli, help) gets
// Tab/etc. raw — otherwise tmux intercepts the key and shifts focus to a
// pane, visually covering the popup ("popup disappears" bug).

const NAV_KEYS = ['Tab', 'C-t', 'M-,', 'M-.', 'M--', 'M-='];

const NAV_FILE = join(STATE_DIR, 'nav-targets.json');
interface NavTargets { sessionName: string; right: string; artifacts: string }

function saveNavTargets(t: NavTargets): void {
  if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(NAV_FILE, JSON.stringify(t), 'utf8');
}
function loadNavTargets(): NavTargets | null {
  try { return JSON.parse(readFileSync(NAV_FILE, 'utf8')) as NavTargets; }
  catch { return null; }
}

export function applyNavBindings(sessionName: string,
                                 rightPaneId: string,
                                 artifactsPaneId: string): void {
  const epicsId = `${sessionName}:0.1`;
  saveNavTargets({ sessionName, right: rightPaneId, artifacts: artifactsPaneId });

  tmuxQuiet([
    'bind-key', '-T', 'root', '-N', 'cycle (Tab pass-through in Claude)',
    'Tab',
    'if-shell', '-F',
    `#{==:#{pane_id},${rightPaneId}}`,
    'send-keys Tab',
    `if-shell -F '#{==:#{pane_id},${artifactsPaneId}}' 'select-pane -t ${rightPaneId}' 'select-pane -t ${artifactsPaneId}'`,
  ]);
  tmuxQuiet([
    'bind-key', '-T', 'root', '-N', 'global cycle (works in Claude)',
    'C-t',
    'if-shell', '-F',
    `#{==:#{pane_id},${rightPaneId}}`,
    `select-pane -t ${epicsId}`,
    `if-shell -F '#{==:#{pane_id},${artifactsPaneId}}' 'select-pane -t ${rightPaneId}' 'select-pane -t ${artifactsPaneId}'`,
  ]);

  tmuxQuiet(['bind-key', '-T', 'root', '-N', 'shrink left column',
             'M-,', 'resize-pane', '-t', epicsId, '-L', '5']);
  tmuxQuiet(['bind-key', '-T', 'root', '-N', 'grow left column',
             'M-.', 'resize-pane', '-t', epicsId, '-R', '5']);
  tmuxQuiet(['bind-key', '-T', 'root', '-N', 'shrink epics row',
             'M--', 'resize-pane', '-t', epicsId, '-U', '3']);
  tmuxQuiet(['bind-key', '-T', 'root', '-N', 'grow epics row',
             'M-=', 'resize-pane', '-t', epicsId, '-D', '3']);
}

function suspendNavBindings(): void {
  for (const k of NAV_KEYS) tmuxQuiet(['unbind-key', '-T', 'root', k]);
}

function resumeNavBindings(): void {
  const t = loadNavTargets();
  if (t) applyNavBindings(t.sessionName, t.right, t.artifacts);
}

/** Apply a previously saved layout. Returns true if applied. */
export function applyLayout(sessionName: string, layout: string): boolean {
  try {
    tmux(['select-layout', '-t', `${sessionName}:0`, layout]);
    return true;
  } catch { return false; }
}
