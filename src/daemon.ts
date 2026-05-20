import { writeState, subscribeEvents } from './ipc/store.js';
import { initialState, STATE_DIR, type SharedState, type Event } from './ipc/state.js';
import { loadConfig } from './config/index.js';
import { existsSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { fetchEpics } from './jira/epics.js';
import { searchCliEpics } from './jira/cli.js';
import { loadPrefs, savePrefs } from './ipc/ui-prefs.js';
import { scanEpicArtifacts, listEpicFolders } from './product-hub/scanner.js';
import { findFeatureBranches, findEpicFolderOnBranch } from './product-hub/branch-scanner.js';
import { ensureWorktree, ensureMainWorktree, updateMainWorktree } from './product-hub/worktree.js';
import { startWatcher } from './product-hub/watch.js';
import { computeDashboard, annotateArtifactStates } from './workflow/drift.js';
import { respawnRightPane, notifyRightPane, captureLayout, applyLayout, applyPaneLabels, showQuitConfirm, showHelpPopup, showJiraDetailPopup, showGhDashPopup } from './tmux/session.js';
import { writeGhDashConfig } from './gh-dash-config.js';
import { pickViewer } from './viewer.js';

const cfg = loadConfig();
const PID_FILE = join(STATE_DIR, 'daemon.pid');

let state: SharedState = initialState(cfg.productHubPath);
state.productHubExists = existsSync(cfg.productHubPath);

// Shared anchor for non-feat-branch epics: a detached worktree pinned to
// origin/master. Lets us ignore whatever branch the user's own working tree
// happens to be on, and keeps reads/writes off it entirely.
let mainWorktreePath: string | undefined;
if (state.productHubExists) {
  try { mainWorktreePath = ensureMainWorktree(cfg.productHubPath); } catch {}
}

// Drop a PID file so cli.ts can detect an already-running daemon.
try { writeFileSync(PID_FILE, String(process.pid), 'utf8'); } catch {}

const publish = () => {
  state = { ...state, updatedAt: new Date().toISOString() };
  writeState(state);
};

const toast = (level: 'info' | 'success' | 'warn' | 'error', text: string,
               pane?: 'epics' | 'hub') => {
  state.toast = {
    id: String(Date.now()) + Math.random().toString(36).slice(2, 6),
    level,
    text,
    createdAt: new Date().toISOString(),
    pane,
  };
  publish();
};

publish();

const findEpic = (epicKey: string): import('./ipc/state.js').Epic | undefined =>
  state.epics.find((e) => e.key === epicKey)
  ?? state.epicSearch?.results.find((e) => e.key === epicKey);

const resolveEpicFolder = (
  mainFolders: string[],
  epicKey: string,
): { folder?: string; branch?: string } => {
  const onMain = mainFolders.find((f) => f.includes(epicKey));
  if (onMain) return { folder: onMain };
  if (!state.productHubExists) return {};
  for (const ref of findFeatureBranches(cfg.productHubPath, epicKey)) {
    const folder = findEpicFolderOnBranch(cfg.productHubPath, ref, epicKey);
    if (folder) return { folder, branch: ref };
  }
  return {};
};

const reannotateEpicFolders = () => {
  if (!state.productHubExists) return;
  const folders = mainWorktreePath ? listEpicFolders(mainWorktreePath) : [];
  const apply = (e: import('./ipc/state.js').Epic) => {
    const r = resolveEpicFolder(folders, e.key);
    e.folder = r.folder;
    e.branch = r.branch;
  };
  for (const e of state.epics) apply(e);
  if (state.epicSearch) for (const e of state.epicSearch.results) apply(e);
};

const refreshArtifactsFor = (epicKey: string) => {
  const epic = findEpic(epicKey);
  if (!epic?.folder) {
    if (epic) state.artifacts = { ...state.artifacts, [epicKey]: [] };
    return;
  }
  // Branch epic before select-epic has no worktree yet → can't scan.
  if (epic.branch && !epic.worktreePath) {
    state.artifacts = { ...state.artifacts, [epicKey]: [] };
    return;
  }
  const root = epic.worktreePath ?? cfg.productHubPath;
  try {
    const raw = scanEpicArtifacts(root, epic.folder);
    state.artifacts = {
      ...state.artifacts,
      [epicKey]: epic.branch ? raw : annotateArtifactStates(root, epic.folder, raw),
    };
    state.dashboard = computeDashboard(root, epic.folder, epic);
  } catch {
    state.artifacts = { ...state.artifacts, [epicKey]: [] };
  }
};

const reconcileSelection = () => {
  if (state.selectedEpic && !findEpic(state.selectedEpic)) {
    state.selectedEpic = undefined;
  }
};

const hasBin = (bin: string): boolean => {
  try {
    execFileSync('which', [bin], { stdio: ['ignore', 'ignore', 'ignore'] });
    return true;
  } catch { return false; }
};

const hasJiraCliConfig = (): boolean => {
  const candidates = [
    join(process.env.HOME ?? '', '.config', '.jira', '.config.yml'),
    join(process.env.HOME ?? '', '.config', 'jira', '.config.yml'),
    join(process.env.HOME ?? '', '.jira.d', 'config.yml'),
  ];
  return candidates.some((p) => existsSync(p));
};

const hasGhDash = (): boolean => {
  try {
    const out = execFileSync('gh', ['extension', 'list'],
      { stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000 }).toString();
    return /\bdlvhdr\/gh-dash\b/.test(out) || /\bgh-dash\b/.test(out);
  } catch { return false; }
};

const checkCliHealth = (bin: string, args: string[], timeoutMs = 4000):
  'ok' | 'missing' | 'unauthed' => {
  try {
    execFileSync(bin, args, { stdio: ['ignore', 'ignore', 'pipe'], timeout: timeoutMs });
    return 'ok';
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    return e.code === 'ENOENT' ? 'missing' : 'unauthed';
  }
};

const refreshHealth = (): void => {
  state.health = {
    acli: checkCliHealth('acli', ['auth', 'status']),
    gh:   checkCliHealth('gh',   ['auth', 'status']),
  };
  publish();
};

const syncProductHub = async (): Promise<void> => {
  if (!state.productHubExists) {
    toast('error', 'product-hub 디렉토리 없음', 'hub');
    return;
  }
  toast('info', '⟳ origin fetch + main worktree 갱신…', 'hub');
  // --prune: drop refs deleted on origin; --force: accept non-ff updates
  // on force-pushed feat branches.
  const fetchArgs = ['fetch', '--prune', '--force', '--quiet', 'origin'];
  try {
    execFileSync('git', fetchArgs, {
      cwd: cfg.productHubPath,
      stdio: ['ignore', 'ignore', 'pipe'],
      timeout: 60_000,
    });
  } catch (err) {
    const msg = (err as Error).message.split('\n').slice(0, 2).join(' ').slice(0, 100);
    toast('warn', `일부 ref fetch 실패 (계속 진행): ${msg}`, 'hub');
  }
  try {
    if (!mainWorktreePath) {
      try { mainWorktreePath = ensureMainWorktree(cfg.productHubPath); } catch {}
    }
    if (mainWorktreePath) updateMainWorktree(cfg.productHubPath);
    reannotateEpicFolders();
    if (state.selectedEpic) refreshArtifactsFor(state.selectedEpic);
    toast('success', '✓ product-hub 갱신 완료', 'hub');
  } catch (err) {
    toast('error', `main worktree 갱신 실패: ${(err as Error).message.slice(0, 80)}`, 'hub');
  } finally {
    publish();
  }
};

const refreshAllEpics = async (announce = true) => {
  state.jiraStatus = 'loading';
  publish();
  try {
    const epics = await fetchEpics(cfg);
    const folders = mainWorktreePath ? listEpicFolders(mainWorktreePath) : [];
    for (const e of epics) {
      const r = resolveEpicFolder(folders, e.key);
      e.folder = r.folder;
      e.branch = r.branch;
    }
    state.epics = epics;
    state.jiraStatus = 'ok';
    reconcileSelection();
    if (state.selectedEpic) refreshArtifactsFor(state.selectedEpic);
    if (announce) toast('success', `✓ Jira 에픽 ${epics.length}건 로드`, 'epics');
  } catch (err) {
    const msg = (err as Error).message.slice(0, 60);
    state.jiraStatus = `error: ${msg}`;
    if (announce) toast('error', `✗ Jira 조회 실패: ${msg}`, 'epics');
  } finally {
    publish();
  }
};

const handleEvent = (ev: Event) => {
  if (ev.type === 'select-epic') {
    const prevSelected = state.selectedEpic;
    // Same epic re-click → no-op (avoid restarting claude and losing context).
    if (prevSelected === ev.epicKey) {
      toast('info', `${ev.epicKey} 이미 활성`);
      return;
    }
    state.selectedEpic = ev.epicKey;
    refreshArtifactsFor(ev.epicKey);
    publish();

    const epic = findEpic(ev.epicKey);

    // `claude --continue` resumes the cwd's most recent conversation; falls
    // back to a fresh session if there isn't one yet. Each epic (own folder
    // OR worktree) has its own cwd, so claude tracks them independently.
    const claudeCmd = `${cfg.claudeBin} --continue 2>/dev/null || ${cfg.claudeBin}`;

    if (!state.productHubExists) {
      notifyRightPane(`[ZAX] product-hub 디렉토리가 없습니다 (${cfg.productHubPath}).\n  gh repo clone zigbang/product-hub ${cfg.productHubPath}`);
      toast('error', 'product-hub 없음 — 클론 후 다시 시도');
    } else if (epic?.branch && epic.folder) {
      try {
        const wt = ensureWorktree(cfg.productHubPath, ev.epicKey, epic.branch);
        epic.worktreePath = wt;
        refreshArtifactsFor(ev.epicKey);
        publish();
        const epicCwd = join(wt, 'epics', epic.folder);
        respawnRightPane(cfg.tmuxSession, epicCwd, claudeCmd);
        toast('info', `→ ${ev.epicKey} · ${epic.branch.replace(/^origin\//, '')} worktree`);
      } catch (err) {
        toast('error', `worktree 생성 실패: ${(err as Error).message.slice(0, 80)}`);
      }
    } else {
      // Non-branch epic anchors to the shared main worktree, not the user's
      // own working tree (which may be on any feat branch).
      const root = mainWorktreePath ?? cfg.productHubPath;
      if (epic) epic.worktreePath = root;

      const epicCwd = epic?.folder ? join(root, 'epics', epic.folder) : null;
      const epicCwdExists = epicCwd ? existsSync(epicCwd) : false;

      const epicsRoot = join(root, 'epics');
      const fallbackCwd = existsSync(epicsRoot) ? epicsRoot : root;
      const cwd = epicCwdExists ? epicCwd! : fallbackCwd;

      respawnRightPane(cfg.tmuxSession, cwd, claudeCmd);
      publish();

      if (epicCwdExists) {
        toast('info', `→ ${ev.epicKey} · claude`);
      } else {
        toast('info', `→ ${ev.epicKey} · 새 에픽 (폴더 없음) — claude에서 부트스트랩`);
      }
    }
  } else if (ev.type === 'open-file') {
    const fname = basename(ev.absPath);
    if (/\.html?$/i.test(ev.absPath)) {
      try {
        spawn('open', [ev.absPath], { detached: true, stdio: 'ignore' }).unref();
        toast('info', `→ ${fname} · 기본 브라우저`);
      } catch (err) {
        toast('error', `브라우저 열기 실패: ${(err as Error).message.slice(0, 60)}`);
      }
      return;
    }
    try {
      const v = pickViewer(ev.absPath);
      const winName = `${fname}  (${v.closeKey})`;
      execFileSync('tmux', [
        'new-window', '-t', `${cfg.tmuxSession}:`,
        '-n', winName, v.cmd,
      ], { stdio: 'ignore' });
      toast('info', `→ ${fname} 열림 (${v.name}) · 편집:i / 저장:Shift+ZZ / 닫기:${v.closeKey}`);
    } catch (err) {
      toast('error', `파일 열기 실패: ${(err as Error).message.slice(0, 60)}`);
    }
  } else if (ev.type === 'refresh-jira') {
    void refreshAllEpics(true);
  } else if (ev.type === 'refresh-hub') {
    void syncProductHub();
  } else if (ev.type === 'quit') {
    void shutdown('quit-event');
  } else if (ev.type === 'kill-all') {
    try {
      execFileSync('tmux', ['kill-session', '-t', cfg.tmuxSession], { stdio: 'ignore' });
    } catch {}
    void shutdown('kill-all');
  } else if (ev.type === 'confirm-quit') {
    void (async () => {
      const ok = await showQuitConfirm();
      if (ok) {
        try {
          execFileSync('tmux', ['kill-session', '-t', cfg.tmuxSession], { stdio: 'ignore' });
        } catch {}
        void shutdown('confirm-quit');
      }
    })();
  } else if (ev.type === 'show-help') {
    void showHelpPopup();
  } else if (ev.type === 'show-jira-detail') {
    if (!hasBin('jira')) {
      toast('error', 'jira-cli 미설치 — brew install ankitpokhrel/jira-cli/jira-cli');
      return;
    }
    if (!hasJiraCliConfig()) {
      toast('warn', 'jira-cli 인증 필요 — 새 터미널에서 `jira init` 실행');
      return;
    }
    void showJiraDetailPopup(ev.epicKey);
  } else if (ev.type === 'show-gh-dash') {
    if (!hasBin('gh')) { toast('error', 'gh 미설치'); return; }
    if (!hasGhDash())  { toast('error', 'gh-dash 미설치 — gh extension install dlvhdr/gh-dash'); return; }
    try {
      const cfg2 = writeGhDashConfig(ev.epicKey);
      const epic = findEpic(ev.epicKey);
      const cwd = epic?.worktreePath ?? cfg.productHubPath;
      void showGhDashPopup(ev.epicKey, cfg2, cwd);
    } catch (err) {
      toast('error', `gh-dash 실행 실패: ${(err as Error).message.slice(0, 80)}`);
    }
  } else if (ev.type === 'open-browser') {
    try {
      spawn('open', [ev.url], { detached: true, stdio: 'ignore' }).unref();
    } catch (err) {
      toast('error', `브라우저 열기 실패: ${(err as Error).message.slice(0, 80)}`);
    }
  } else if (ev.type === 'jira-search') {
    const q = ev.query.trim();
    if (!q) {
      state.epicSearch = undefined;
      publish();
      return;
    }
    state.epicSearch = {
      query: q,
      status: 'loading',
      results: state.epicSearch?.results ?? [],
    };
    publish();
    void (async () => {
      try {
        const results = await searchCliEpics(q);
        const folders = mainWorktreePath ? listEpicFolders(mainWorktreePath) : [];
        for (const e of results) {
          const r = resolveEpicFolder(folders, e.key);
          e.folder = r.folder;
          e.branch = r.branch;
        }
        state.epicSearch = { query: q, status: 'ok', results };
        toast('success', `🔍 "${q}" — ${results.length}건`);
      } catch (err) {
        const msg = (err as Error).message.slice(0, 80);
        state.epicSearch = { query: q, status: 'error', results: [], message: msg };
        toast('error', `검색 실패: ${msg}`);
      } finally {
        publish();
      }
    })();
  } else if (ev.type === 'jira-search-clear') {
    state.epicSearch = undefined;
    publish();
  }
};

const stopEvents = subscribeEvents(handleEvent);
const stopFsWatch = state.productHubExists
  ? startWatcher(cfg.productHubPath, () => {
      if (state.selectedEpic) {
        refreshArtifactsFor(state.selectedEpic);
        publish();
      }
    })
  : () => {};

refreshHealth();

const prefs = loadPrefs();
if (prefs.selectedEpicKey) state.selectedEpic = prefs.selectedEpicKey;
publish();

let layoutRestoreAttempts = 0;
const tryRestoreLayout = () => {
  // Re-read prefs each attempt: cli.ts may have wiped tmuxLayout right
  // after a fresh buildSession, and we must not restore a stale layout.
  const cur = loadPrefs();
  if (!cur.tmuxLayout) return;
  layoutRestoreAttempts++;
  if (applyLayout(cfg.tmuxSession, cur.tmuxLayout)) return;
  if (layoutRestoreAttempts < 10) setTimeout(tryRestoreLayout, 500);
};
setTimeout(tryRestoreLayout, 400);

// Re-apply pane titles after shells have finished startup (they emit OSC 2
// that overrides our titles). Multiple delays cover slow .zshrc loads.
setTimeout(applyPaneLabels, 600);
setTimeout(applyPaneLabels, 1800);
setTimeout(applyPaneLabels, 4000);

// Layout-save IS a poll, but it's a free local read (tmux list-windows) with
// no API call. Kept so resize gestures persist without user action.
let lastSavedLayout = prefs.tmuxLayout ?? '';
const layoutSaveTimer = setInterval(() => {
  const cur = captureLayout(cfg.tmuxSession);
  if (cur && cur !== lastSavedLayout) {
    lastSavedLayout = cur;
    savePrefs({ tmuxLayout: cur });
  }
}, 2_000);

void refreshAllEpics(false);   // initial — no toast on startup

// If the tmux session disappears, the daemon must exit too — otherwise it
// outlives its UI and keeps polling Jira invisibly. Grace period covers the
// gap between daemon spawn and session build.
const startedAt = Date.now();
const TMUX_GRACE_MS = 10_000;

const tmuxAlive = (): boolean => {
  try {
    execFileSync('tmux', ['has-session', '-t', cfg.tmuxSession],
      { stdio: ['ignore', 'ignore', 'ignore'] });
    return true;
  } catch {
    return false;
  }
};

const tmuxTimer = setInterval(() => {
  if (Date.now() - startedAt < TMUX_GRACE_MS) return;
  if (!tmuxAlive()) {
    void shutdown('tmux-gone');
  }
}, 5_000);

let shuttingDown = false;
async function shutdown(reason: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;

  clearInterval(tmuxTimer);
  clearInterval(layoutSaveTimer);

  try {
    const finalLayout = captureLayout(cfg.tmuxSession);
    if (finalLayout && finalLayout !== lastSavedLayout) savePrefs({ tmuxLayout: finalLayout });
  } catch {}
  try { stopEvents(); } catch {}
  try { stopFsWatch(); } catch {}

  // Kill any direct children (acli call mid-flight, etc.).
  try {
    execFileSync('pkill', ['-9', '-P', String(process.pid)],
      { stdio: ['ignore', 'ignore', 'ignore'] });
  } catch {}

  try { unlinkSync(PID_FILE); } catch {}

  process.stderr.write(`[zax-daemon] shutdown (${reason})\n`);
  process.exit(0);
}

process.on('SIGINT', () => { void shutdown('SIGINT'); });
process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
process.on('SIGHUP', () => { void shutdown('SIGHUP'); });
