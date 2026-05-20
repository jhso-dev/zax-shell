import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const WORKTREES_ROOT = process.env.ZAX_SHELL_WORKTREES_DIR
  ?? join(homedir(), '.cache', 'zax-shell', 'worktrees');

const MAIN_WT = join(WORKTREES_ROOT, '_main');

const gitQuiet = (cwd: string, args: string[]): void => {
  execFileSync('git', ['-c', 'core.quotepath=false', ...args], {
    cwd, stdio: ['ignore', 'ignore', 'pipe'], timeout: 30_000,
  });
};

// Detect "master" vs "main" — zigbang product-hub uses master, others use main.
function defaultBranchRef(productHubPath: string): string {
  for (const ref of ['origin/master', 'origin/main']) {
    try {
      execFileSync('git', ['rev-parse', '--verify', ref], {
        cwd: productHubPath, stdio: 'ignore',
      });
      return ref;
    } catch {}
  }
  return 'origin/HEAD';
}

/**
 * Materialize a shared, detached worktree pinned to origin/(master|main).
 * Used as the anchor for "normal" (already-merged) epics so the user's own
 * working tree — which may be on any feat branch — doesn't influence what
 * zax-shell shows.
 */
export function ensureMainWorktree(productHubPath: string): string {
  if (!existsSync(WORKTREES_ROOT)) mkdirSync(WORKTREES_ROOT, { recursive: true });
  const ref = defaultBranchRef(productHubPath);
  if (!existsSync(MAIN_WT)) {
    gitQuiet(productHubPath, ['worktree', 'add', '--detach', MAIN_WT, ref]);
  }
  return MAIN_WT;
}

/** Re-point the shared main worktree at the latest origin tip. */
export function updateMainWorktree(productHubPath: string): void {
  if (!existsSync(MAIN_WT)) return;
  const ref = defaultBranchRef(productHubPath);
  gitQuiet(MAIN_WT, ['checkout', '--detach', ref]);
}

export function ensureWorktree(productHubPath: string,
                               epicKey: string,
                               branchRef: string): string {
  if (!existsSync(WORKTREES_ROOT)) mkdirSync(WORKTREES_ROOT, { recursive: true });
  const wt = join(WORKTREES_ROOT, epicKey);
  if (existsSync(wt)) return wt;

  const localBranch = branchRef.replace(/^origin\//, '');
  try {
    gitQuiet(productHubPath, ['worktree', 'add', '-B', localBranch, wt, branchRef]);
  } catch {
    gitQuiet(productHubPath, ['worktree', 'add', '--detach', wt, branchRef]);
  }
  return wt;
}
