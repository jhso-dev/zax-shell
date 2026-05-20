import { describe, it, expect, afterEach } from 'vitest';
import { existsSync } from 'node:fs';
import { getStageTreeHash } from '../src/workflow/tree-hash.js';
import { makeFixtureRepo, commitMore, type Fixture } from './helpers/fixture-repo.js';

// Import zax's original implementation directly to compare.
// Path is resolved at runtime — skip the compat test if it's missing.
const ZAX_PATH = '/Users/jinhoso/dev/product-harness/plugins/zax/hooks/lib/frontmatter-utils.mjs';
const haveZax = existsSync(ZAX_PATH);

let zaxGet: ((p: string, e: string, s: string) => string | null) | null = null;
if (haveZax) {
  const mod = await import(ZAX_PATH);
  zaxGet = mod.getStageTreeHash as typeof zaxGet;
}

const PRD = (title: string, body: string) => ({
  path: 'epics/EPIC-1/docs/prd/prd.md',
  frontmatter: { type: 'prd', epic: 'EPIC-1', title },
  body,
});

const ARCH = (body: string, prdRef: string) => ({
  path: 'epics/EPIC-1/artifacts/architecture/architecture.md',
  frontmatter: { type: 'architecture', prd_tree_hash: prdRef },
  body,
});

describe('getStageTreeHash', () => {
  let fix: Fixture | null = null;
  afterEach(() => { fix?.cleanup(); fix = null; });

  it('returns 16-hex SHA-1 for a stage with files', () => {
    fix = makeFixtureRepo([PRD('first', '# Hello\nbody A\n')]);
    const h = getStageTreeHash(fix.repoPath, 'EPIC-1', 'docs/prd');
    expect(h).toMatch(/^[0-9a-f]{16}$/);
  });

  it('returns null for empty/missing stage', () => {
    fix = makeFixtureRepo([PRD('first', 'x')]);
    const h = getStageTreeHash(fix.repoPath, 'EPIC-1', 'artifacts/spec');
    expect(h).toBeNull();
  });

  it('ignores frontmatter changes — body-only hashing', () => {
    fix = makeFixtureRepo([PRD('first', '# Body\ncontent\n')]);
    const h1 = getStageTreeHash(fix.repoPath, 'EPIC-1', 'docs/prd');
    commitMore(fix, [PRD('SECOND TITLE', '# Body\ncontent\n')]);
    const h2 = getStageTreeHash(fix.repoPath, 'EPIC-1', 'docs/prd');
    expect(h1).toBe(h2);
  });

  it('changes when body changes', () => {
    fix = makeFixtureRepo([PRD('t', '# v1\n')]);
    const h1 = getStageTreeHash(fix.repoPath, 'EPIC-1', 'docs/prd');
    commitMore(fix, [PRD('t', '# v2\n')]);
    const h2 = getStageTreeHash(fix.repoPath, 'EPIC-1', 'docs/prd');
    expect(h1).not.toBe(h2);
  });

  it('excludes changelog.md from prd stage', () => {
    const withChangelog = makeFixtureRepo([
      PRD('t', '# main\n'),
      { path: 'epics/EPIC-1/docs/prd/changelog.md', body: '# changelog\n' },
    ]);
    const withoutChangelog = makeFixtureRepo([PRD('t', '# main\n')]);

    try {
      const h1 = getStageTreeHash(withChangelog.repoPath, 'EPIC-1', 'docs/prd');
      const h2 = getStageTreeHash(withoutChangelog.repoPath, 'EPIC-1', 'docs/prd');
      expect(h1).toBe(h2);
    } finally {
      withChangelog.cleanup();
      withoutChangelog.cleanup();
    }
  });

  it.skipIf(!haveZax)('matches zax plugin output exactly (prd)', () => {
    fix = makeFixtureRepo([PRD('t', '# Some body\nwith\nlines\n')]);
    const ours = getStageTreeHash(fix.repoPath, 'EPIC-1', 'docs/prd');
    const theirs = zaxGet!(fix.repoPath, 'EPIC-1', 'docs/prd');
    expect(ours).toBe(theirs);
    expect(ours).not.toBeNull();
  });

  it.skipIf(!haveZax)('matches zax plugin output exactly (architecture w/ multiple files)', () => {
    fix = makeFixtureRepo([
      PRD('t', 'prd body\n'),
      ARCH('arch body 1\n', 'abc123'),
      {
        path: 'epics/EPIC-1/artifacts/architecture/architecture_p1.md',
        frontmatter: { type: 'architecture', prd_tree_hash: 'abc123' },
        body: 'phase 1 body\n',
      },
    ]);
    const ours = getStageTreeHash(fix.repoPath, 'EPIC-1', 'artifacts/architecture');
    const theirs = zaxGet!(fix.repoPath, 'EPIC-1', 'artifacts/architecture');
    expect(ours).toBe(theirs);
  });

  // Regression: real-world docs often have CRLF, trailing spaces, and an
  // empty line right after the frontmatter. Earlier zax-shell skipped CRLF
  // normalization and stripped that empty line, producing wrong hashes that
  // showed every stage as stale on Hero-copy-style epics.
  it.skipIf(!haveZax)('matches zax with CRLF + trailing-space + blank-after-fm body', () => {
    fix = makeFixtureRepo([{
      path: 'epics/EPIC-1/docs/prd/prd.md',
      frontmatter: { type: 'prd' },
      // Empty line after `---`, trailing space on a line, CRLF line ending.
      body: '\n# Title  \r\nThe Hero copy needs review.   \n\n## Section\nMore body\n',
    }]);
    const ours = getStageTreeHash(fix.repoPath, 'EPIC-1', 'docs/prd');
    const theirs = zaxGet!(fix.repoPath, 'EPIC-1', 'docs/prd');
    expect(ours).toBe(theirs);
  });
});
