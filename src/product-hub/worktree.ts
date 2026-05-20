import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { gitQuiet, gitOut } from '../util/git.js';
import { ZAX_HOME } from '../util/paths.js';

const WORKTREES_ROOT = process.env.ZAX_SHELL_WORKTREES_DIR
  ?? join(ZAX_HOME, 'state', 'worktrees');

const MAIN_WT = join(WORKTREES_ROOT, '_main');

// Detect "master" vs "main" — zigbang product-hub uses master, others use main.
function defaultBranchRef(productHubPath: string): string {
  for (const ref of ['origin/master', 'origin/main']) {
    try { gitQuiet(productHubPath, ['rev-parse', '--verify', ref]); return ref; }
    catch {}
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

/**
 * Origin refs that make sense as branches for a given epic.
 * Order: default branch (master/main) first, then feat/{KEY}/{stage} in
 * workflow order (prd → architecture → spec → test-case → anything else).
 */
export function listBranchCandidates(productHubPath: string, epicKey: string): string[] {
  const out: string[] = [defaultBranchRef(productHubPath)];
  try {
    const refs = gitOut(productHubPath, [
      'for-each-ref', '--format=%(refname:short)',
      `refs/remotes/origin/feat/${epicKey}/`,
    ]).split('\n').map((s) => s.trim()).filter(Boolean);

    const rank: Record<string, number> = { prd: 0, architecture: 1, spec: 2, 'test-case': 3 };
    refs.sort((a, b) => {
      const sa = a.split('/').pop() ?? '';
      const sb = b.split('/').pop() ?? '';
      const ra = rank[sa] ?? 99;
      const rb = rank[sb] ?? 99;
      return ra !== rb ? ra - rb : a.localeCompare(b);
    });
    out.push(...refs);
  } catch {}
  return out;
}

/** Current HEAD ref name of a worktree (short branch name or short SHA). */
export function currentHead(worktreePath: string): string {
  try {
    return gitOut(worktreePath, ['rev-parse', '--abbrev-ref', 'HEAD']).trim() ||
           gitOut(worktreePath, ['rev-parse', '--short', 'HEAD']).trim();
  } catch { return ''; }
}

/**
 * Switch a worktree to the given ref. Prefers a real local branch (so
 * subsequent commits are useful), but falls back to a detached HEAD when
 * the branch is already checked out by another worktree.
 */
export function switchWorktreeBranch(worktreePath: string, ref: string): void {
  const local = ref.replace(/^origin\//, '');
  try {
    gitQuiet(worktreePath, ['switch', '-C', local, ref]);
  } catch {
    gitQuiet(worktreePath, ['checkout', '--detach', ref]);
  }
}
