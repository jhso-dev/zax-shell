import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import fg from 'fast-glob';
import matter from 'gray-matter';

export interface StageFm {
  /** Hash of the upstream stage at the time this doc was written. */
  prd_tree_hash?: string;
  architecture_tree_hash?: string;
  spec_tree_hash?: string;
  [k: string]: unknown;
}

const STAGE_TO_GLOB = {
  prd: 'docs/prd/prd*.md',
  architecture: 'artifacts/architecture/architecture*.md',
  spec: 'artifacts/spec/spec*.md',
  'test-case': 'artifacts/test-case/test-case*.md',
} as const;

export type Stage = keyof typeof STAGE_TO_GLOB;

/** Returns first matching file in stage dir (sorted). */
export function findStageFile(
  productHubPath: string,
  epicFolder: string,
  stage: Stage,
): string | null {
  const root = join(productHubPath, 'epics', epicFolder);
  if (!existsSync(root)) return null;
  const matches = fg.sync(STAGE_TO_GLOB[stage], { cwd: root, onlyFiles: true });
  if (matches.length === 0) return null;
  matches.sort();
  return join(root, matches[0]!);
}

export function readFm(absPath: string): StageFm {
  try {
    return (matter(readFileSync(absPath, 'utf8')).data as StageFm) ?? {};
  } catch {
    return {};
  }
}
