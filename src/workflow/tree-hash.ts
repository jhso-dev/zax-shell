import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { basename } from 'node:path';

/**
 * Port of zax's getStageTreeHash (plugins/zax/hooks/lib/frontmatter-utils.mjs).
 * Reads files via `git ls-tree origin/HEAD`, strips frontmatter, hashes bodies,
 * sorts, then sha1[:16] of the serialized lines.
 *
 * Returns null if no files match.
 */
export type StageDir =
  | 'docs/prd'
  | 'artifacts/architecture'
  | 'artifacts/spec'
  | 'artifacts/test-case';

const NAME_RE: Record<StageDir, RegExp> = {
  'docs/prd':                /^prd[^/]*\.md$/,
  'artifacts/architecture':  /^architecture[^/]*\.md$/,
  'artifacts/spec':          /^spec[^/]*\.md$/,
  'artifacts/test-case':     /^test-case[^/]*\.md$/,
};

/**
 * Bit-for-bit copy of zax/hooks/lib/frontmatter-utils.mjs:stripFrontmatter.
 * The hash is the SHA-1 of this output, so any deviation produces a
 * different hash than zax — leading to false stale/drift indicators.
 */
const stripFrontmatter = (content: string): string => {
  if (content === '') return '';
  const normalized = content.replace(/\r\n/g, '\n');
  const fmMatch = normalized.match(/^---\n[\s\S]*?\n---\n?/);
  const body = fmMatch ? normalized.slice(fmMatch[0].length) : normalized;
  const trimmed = body.split('\n').map((s) => s.replace(/[ \t]+$/, '')).join('\n');
  const noTrailing = trimmed.replace(/\n+$/, '');
  if (noTrailing === '') return '';
  return noTrailing + '\n';
};

const parseFm = (content: string): Record<string, unknown> | null => {
  if (!content.startsWith('---')) return null;
  const end = content.indexOf('\n---', 3);
  if (end === -1) return null;
  const yaml = content.slice(3, end);
  const fm: Record<string, unknown> = {};
  for (const line of yaml.split('\n')) {
    const m = line.match(/^([a-zA-Z0-9_]+):\s*(.*)$/);
    if (m) fm[m[1]!] = m[2]!.trim().replace(/^['"]|['"]$/g, '');
  }
  return fm;
};

interface Opts {
  phase?: number | null;
}

export function getStageTreeHash(
  productHubPath: string,
  epicFolder: string,
  stageDir: StageDir,
  opts: Opts = {},
): string | null {
  try {
    const path = `epics/${epicFolder}/${stageDir}`;
    const lsOut = execFileSync(
      'git',
      ['-c', 'core.quotePath=false', 'ls-tree', 'origin/HEAD', `${path}/`],
      { cwd: productHubPath, stdio: ['pipe', 'pipe', 'pipe'], timeout: 4000 },
    ).toString();

    interface Entry { basename: string; blobSha: string }
    const entries: Entry[] = [];
    for (const line of lsOut.split('\n')) {
      if (!line.trim()) continue;
      const tabIdx = line.indexOf('\t');
      if (tabIdx === -1) continue;
      const meta = line.slice(0, tabIdx).trim().split(/\s+/);
      const blobType = meta[1];
      const blobSha = meta[2];
      const fullPath = line.slice(tabIdx + 1).trim();
      if (!blobSha || !fullPath || blobType !== 'blob') continue;
      entries.push({ basename: basename(fullPath), blobSha });
    }

    const re = NAME_RE[stageDir];
    let filtered = entries.filter(({ basename: bn }) => {
      if (stageDir === 'docs/prd' && bn === 'changelog.md') return false;
      return re.test(bn);
    });

    if (opts.phase != null) {
      const phaseRe = new RegExp('_p' + opts.phase + '\\.md$');
      filtered = filtered.filter(({ basename: bn }) => phaseRe.test(bn));
      filtered = filtered.filter(({ blobSha }) => {
        try {
          const blob = execFileSync('git', ['cat-file', 'blob', blobSha], {
            cwd: productHubPath, stdio: ['pipe', 'pipe', 'pipe'], timeout: 4000,
          }).toString();
          const fm = parseFm(blob);
          return !(fm && fm['type'] === 'vision');
        } catch { return true; }
      });
    }

    if (filtered.length === 0) return null;

    const hashed = filtered.map(({ basename: bn, blobSha }) => {
      const blob = execFileSync('git', ['cat-file', 'blob', blobSha], {
        cwd: productHubPath, stdio: ['pipe', 'pipe', 'pipe'], timeout: 4000,
      }).toString();
      const body = stripFrontmatter(blob);
      const bodySha = createHash('sha1').update(body, 'utf8').digest('hex');
      return { basename: bn, bodySha };
    });

    hashed.sort((a, b) => a.basename < b.basename ? -1 : a.basename > b.basename ? 1 : 0);
    const lines = hashed.map((e) => e.basename + ':' + e.bodySha).join('\n') + '\n';
    return createHash('sha1').update(lines, 'utf8').digest('hex').slice(0, 16);
  } catch {
    return null;
  }
}
