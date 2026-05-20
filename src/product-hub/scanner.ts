import { readdirSync, statSync, existsSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import fg from 'fast-glob';
import matter from 'gray-matter';
import type { Artifact } from '../ipc/state.js';

const EPICS_DIR = 'epics';

/**
 * List immediate subdirectories of <productHubPath>/epics/.
 * Names look like "B2C-50055-직방-Hero-copy-수정".
 */
export function listEpicFolders(productHubPath: string): string[] {
  const root = join(productHubPath, EPICS_DIR);
  if (!existsSync(root)) return [];
  try {
    return readdirSync(root).filter((name) => {
      try { return statSync(join(root, name)).isDirectory(); }
      catch { return false; }
    });
  } catch {
    return [];
  }
}

const STAGE_GLOBS: { stage: Artifact['stage']; glob: string; nameRe: RegExp }[] = [
  { stage: 'prd',           glob: 'docs/prd/*.md',                nameRe: /^prd[^/]*\.md$/ },
  { stage: 'architecture',  glob: 'artifacts/architecture/*.md',  nameRe: /^architecture[^/]*\.md$/ },
  { stage: 'spec',          glob: 'artifacts/spec/*.md',          nameRe: /^spec[^/]*\.md$/ },
  { stage: 'test-case',     glob: 'artifacts/test-case/*.md',     nameRe: /^test-case[^/]*\.md$/ },
];

/**
 * Scan one epic folder. Returns one Artifact entry per stage file found.
 * `state` is set to 'ok' here — drift/stale is computed by workflow/drift.ts.
 */
export function scanEpicArtifacts(productHubPath: string, folder: string): Artifact[] {
  const epicRoot = join(productHubPath, EPICS_DIR, folder);
  if (!existsSync(epicRoot)) return [];

  const out: Artifact[] = [];
  for (const { stage, glob, nameRe } of STAGE_GLOBS) {
    const files = fg.sync(glob, { cwd: epicRoot, onlyFiles: true });
    for (const rel of files) {
      const name = rel.split('/').pop()!;
      if (name === 'changelog.md') continue;
      if (!nameRe.test(name)) continue;
      const abs = join(epicRoot, rel);
      let fm: Record<string, unknown> = {};
      try { fm = matter(readFileSync(abs, 'utf8')).data ?? {}; } catch {}
      out.push({
        path: rel,
        stage,
        state: 'ok',
        treeHash: typeof fm['tree_hash'] === 'string' ? fm['tree_hash'] as string : undefined,
        upstreamHash: undefined,
      });
    }
  }

  try {
    const htmlFiles = fg.sync('**/*.html', {
      cwd: epicRoot, onlyFiles: true,
      ignore: ['node_modules/**', '.git/**', '_deployed/**'],
    });
    for (const rel of htmlFiles) {
      out.push({ path: rel, stage: 'other', state: 'ok' });
    }
  } catch {}

  const order = { prd: 0, architecture: 1, spec: 2, 'test-case': 3, other: 4 } as const;
  out.sort((a, b) => {
    const d = (order[a.stage] ?? 9) - (order[b.stage] ?? 9);
    return d !== 0 ? d : a.path.localeCompare(b.path);
  });
  return out;
}

/** Convenience: absolute path of an epic. */
export function epicDir(productHubPath: string, folder: string): string {
  return join(productHubPath, EPICS_DIR, folder);
}

/** Convenience: path relative to product-hub root. */
export function relFromHub(productHubPath: string, abs: string): string {
  return relative(productHubPath, abs);
}
