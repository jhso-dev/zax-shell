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
import {
  ensureWorktree, ensureMainWorktree, updateMainWorktree,
  listBranchCandidates, switchWorktreeBranch, currentHead,
} from './product-hub/worktree.js';
import { startWatcher } from './product-hub/watch.js';
import { computeDashboard, annotateArtifactStates } from './workflow/drift.js';
import { respawnRightPane, notifyRightPane, captureLayout, applyLayout, applyPaneLabels, showQuitConfirm, showHelpPopup, showBranchSwitchPopup } from './tmux/session.js';
import { pickViewer } from './viewer.js';
import { gitQuiet } from './util/git.js';

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
    // Pre-set worktreePath for main-merged epics so refreshArtifactsFor
    // works on first call. Branch-only epics still need select-epic to
    // materialize their dedicated worktree.
    if (r.folder && !r.branch && mainWorktreePath) {
      e.worktreePath = mainWorktreePath;
    }
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
  try {
    gitQuiet(cfg.productHubPath,
      ['fetch', '--prune', '--force', '--quiet', 'origin'], 60_000);
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
      if (r.folder && !r.branch && mainWorktreePath) e.worktreePath = mainWorktreePath;
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
        attachWatcherForSelected();
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
      if (epic) {
        epic.worktreePath = root;
        refreshArtifactsFor(ev.epicKey);
        attachWatcherForSelected();
      }

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
  } else if (ev.type === 'switch-branch') {
    void handleSwitchBranch(ev.epicKey);
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
          if (r.folder && !r.branch && mainWorktreePath) e.worktreePath = mainWorktreePath;
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

// File watcher follows the *selected epic's worktree*, not the user's
// home checkout. When Claude writes new artifacts inside the worktree
// (e.g. running /workflow prd), this picks them up and re-renders the
// Product-Hub pane without a manual refresh. Re-attached every time the
// selected epic changes.
let stopFsWatch: () => void = () => {};
function attachWatcherForSelected(): void {
  try { stopFsWatch(); } catch {}
  stopFsWatch = () => {};
  if (!state.productHubExists) return;
  const epic = state.selectedEpic ? findEpic(state.selectedEpic) : undefined;
  const watchRoot = epic?.worktreePath ?? cfg.productHubPath;
  stopFsWatch = startWatcher(watchRoot, () => {
    if (state.selectedEpic) {
      refreshArtifactsFor(state.selectedEpic);
      publish();
    }
  });
}
attachWatcherForSelected();

refreshHealth();

const prefs = loadPrefs();
// Intentionally not setting state.selectedEpic here. We need to trigger a
// full select-epic flow (claude spawn, worktree refresh) after epics load —
// just stashing the key would leave the right pane empty.
publish();

// Force the dashboard pane back to a fixed 3-row height. Called on a
// short interval AND immediately after every layout change so the user
// never sees a resized dashboard.
function pinDashboardHeight(): void {
  try {
    execFileSync('tmux', ['resize-pane', '-t', `${cfg.tmuxSession}:0.0`, '-y', '3'],
      { stdio: ['ignore', 'ignore', 'ignore'] });
  } catch {}
}

let layoutRestoreAttempts = 0;
const tryRestoreLayout = () => {
  // Re-read prefs each attempt: cli.ts may have wiped tmuxLayout right
  // after a fresh buildSession, and we must not restore a stale layout.
  const cur = loadPrefs();
  if (!cur.tmuxLayout) return;
  layoutRestoreAttempts++;
  if (applyLayout(cfg.tmuxSession, cur.tmuxLayout)) {
    pinDashboardHeight();   // restored layout may have had a non-3 dashboard
    return;
  }
  if (layoutRestoreAttempts < 10) setTimeout(tryRestoreLayout, 500);
};
setTimeout(tryRestoreLayout, 400);
pinDashboardHeight();   // pin immediately too, in case there's nothing to restore

// Re-apply pane titles after shells have finished startup (they emit OSC 2
// that overrides our titles). Multiple delays cover slow .zshrc loads.
setTimeout(applyPaneLabels, 600);
setTimeout(applyPaneLabels, 1800);
setTimeout(applyPaneLabels, 4000);

// Layout-save IS a poll, but it's a free local read (tmux list-windows) with
// no API call. Kept so resize gestures persist without user action.
//
// We refuse to persist any layout that has the dashboard pane at a non-3
// height — that's our invariant, and saving a stale one would only resurrect
// it on the next startup before the timer can pin it again.
function dashboardIsPinned(): boolean {
  try {
    const h = execFileSync('tmux',
      ['display-message', '-t', `${cfg.tmuxSession}:0.0`, '-p', '#{pane_height}'],
      { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    return h === '3';
  } catch { return true; }   // can't read → don't block save
}

let lastSavedLayout = prefs.tmuxLayout ?? '';
const layoutSaveTimer = setInterval(() => {
  const cur = captureLayout(cfg.tmuxSession);
  if (cur && cur !== lastSavedLayout && dashboardIsPinned()) {
    lastSavedLayout = cur;
    savePrefs({ tmuxLayout: cur });
  }
}, 2_000);

// Initial Jira load. When it finishes, restore the previously-selected
// epic so the right pane comes up with claude already running instead of
// the idle banner.
void (async () => {
  await refreshAllEpics(false);
  const restore = prefs.selectedEpicKey;
  if (restore && state.epics.find((e) => e.key === restore)) {
    handleEvent({ type: 'select-epic', epicKey: restore });
  }
})();

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

// Pin the dashboard height aggressively (500ms). Cheap local tmux call —
// no-op when it's already 3 — and tight enough that even a mouse-drag
// resize bounces back before the user can let go of the mouse button.
const dashboardTimer = setInterval(pinDashboardHeight, 500);

// Watch the selected epic's worktree HEAD. If Claude (or anything else)
// `git switch`es it underneath us, refresh artifacts + epic.branch so the
// Product-Hub pane keeps showing the right files.
let lastHeadByEpic: Record<string, string> = {};
const headTimer = setInterval(() => {
  const epicKey = state.selectedEpic;
  if (!epicKey) return;
  const epic = findEpic(epicKey);
  if (!epic?.worktreePath) return;
  const head = currentHead(epic.worktreePath);
  if (!head) return;
  const prev = lastHeadByEpic[epicKey];
  if (prev === undefined) { lastHeadByEpic[epicKey] = head; return; }
  if (prev === head) return;
  lastHeadByEpic[epicKey] = head;

  // HEAD changed under us. If it's a feat branch we now anchor to that
  // worktree's ref; if it's the default branch we drop epic.branch.
  if (/^feat\//.test(head)) epic.branch = `origin/${head}`;
  else epic.branch = undefined;
  refreshArtifactsFor(epicKey);
  attachWatcherForSelected();
  publish();
  toast('info', `→ ${epicKey} · 브랜치 변경 감지: ${head}`, 'hub');
}, 1_500);

async function handleSwitchBranch(epicKey: string): Promise<void> {
  const epic = findEpic(epicKey);
  if (!epic?.worktreePath) {
    toast('error', `${epicKey}: worktree 없음 — 먼저 에픽 선택 필요`, 'hub');
    return;
  }
  // Refresh refs first — otherwise the user sees only whatever feat/{KEY}/*
  // refs happened to be in the last `r` snapshot. Narrow the fetch to this
  // epic's refs so it's a few hundred ms, not several seconds.
  toast('info', `⟳ origin/feat/${epicKey}/* fetch…`, 'hub');
  try {
    gitQuiet(cfg.productHubPath, [
      'fetch', '--prune', '--quiet', 'origin',
      `+refs/heads/feat/${epicKey}/*:refs/remotes/origin/feat/${epicKey}/*`,
    ], 15_000);
  } catch {
    // fall back to whatever refs are already local
  }
  const candidates = listBranchCandidates(cfg.productHubPath, epicKey);
  if (candidates.length === 0) {
    toast('warn', `${epicKey}: 전환 가능한 origin 브랜치 없음`, 'hub');
    return;
  }
  const cur = currentHead(epic.worktreePath);
  const chosen = await showBranchSwitchPopup({
    title: epicKey,
    current: cur,
    candidates,
  });
  if (!chosen) return;
  try {
    switchWorktreeBranch(epic.worktreePath, chosen);
    const local = chosen.replace(/^origin\//, '');
    lastHeadByEpic[epicKey] = local;
    epic.branch = /^feat\//.test(local) ? `origin/${local}` : undefined;
    refreshArtifactsFor(epicKey);
    attachWatcherForSelected();
    publish();
    toast('success', `✓ ${epicKey} · ${local} 으로 전환`, 'hub');
  } catch (err) {
    toast('error', `브랜치 전환 실패: ${(err as Error).message.slice(0, 80)}`, 'hub');
  }
}

let shuttingDown = false;
async function shutdown(reason: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;

  clearInterval(tmuxTimer);
  clearInterval(layoutSaveTimer);
  clearInterval(dashboardTimer);
  clearInterval(headTimer);

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
