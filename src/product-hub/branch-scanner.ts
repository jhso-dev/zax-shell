import { execFileSync } from 'node:child_process';

const STAGE_RANK: Record<string, number> = {
  'test-case': 4, 'spec': 3, 'architecture': 2, 'prd': 1,
};

// core.quotepath=false: keep UTF-8 paths raw so 한글 폴더가 octal escape로 새지 않는다.
const gitOut = (cwd: string, args: string[]): string =>
  execFileSync('git', ['-c', 'core.quotepath=false', ...args], {
    cwd, stdio: ['ignore', 'pipe', 'pipe'], timeout: 8000,
  }).toString();

export function findFeatureBranches(productHubPath: string, epicKey: string): string[] {
  try {
    const out = gitOut(productHubPath, [
      'for-each-ref', '--format=%(refname:short)',
      `refs/remotes/origin/feat/${epicKey}/`,
    ]);
    const refs = out.split('\n').map((s) => s.trim()).filter(Boolean);
    refs.sort((a, b) => {
      const sa = a.split('/').pop() ?? '';
      const sb = b.split('/').pop() ?? '';
      return (STAGE_RANK[sb] ?? 0) - (STAGE_RANK[sa] ?? 0);
    });
    return refs;
  } catch { return []; }
}

export function findEpicFolderOnBranch(productHubPath: string, branchRef: string,
                                       epicKey: string): string | undefined {
  try {
    const out = gitOut(productHubPath, ['ls-tree', '--name-only', branchRef, 'epics/']);
    return out.split('\n')
      .map((s) => s.replace(/^epics\//, '').replace(/\/$/, ''))
      .filter(Boolean)
      .find((n) => n.includes(epicKey));
  } catch { return undefined; }
}
