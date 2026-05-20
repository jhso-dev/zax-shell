import { describe, it, expect, afterEach } from 'vitest';
import { computeDashboard, annotateArtifactStates } from '../src/workflow/drift.js';
import { scanEpicArtifacts } from '../src/product-hub/scanner.js';
import { getStageTreeHash } from '../src/workflow/tree-hash.js';
import { makeFixtureRepo, commitMore, type Fixture } from './helpers/fixture-repo.js';
import type { Epic } from '../src/ipc/state.js';

const EPIC: Epic = { key: 'E1', summary: 's', status: 'In Progress', folder: 'E1' };

const PRD = (body: string, extra: Record<string, string> = {}) => ({
  path: 'epics/E1/docs/prd/prd.md',
  frontmatter: { type: 'prd', ...extra },
  body,
});

const ARCH = (body: string, extra: Record<string, string> = {}) => ({
  path: 'epics/E1/artifacts/architecture/architecture.md',
  frontmatter: { type: 'architecture', ...extra },
  body,
});

describe('computeDashboard', () => {
  let fix: Fixture | null = null;
  afterEach(() => { fix?.cleanup(); fix = null; });

  it('marks all missing as "·"', () => {
    fix = makeFixtureRepo([{ path: 'epics/E1/README.md', body: '\n' }]);
    const db = computeDashboard(fix.repoPath, 'E1', EPIC);
    expect(db.stages.map((s) => s.glyph)).toEqual(['·', '·', '·', '·']);
    expect(db.driftCount).toBe(0);
    expect(db.staleCount).toBe(0);
  });

  it('marks prd as "✓" when present (no upstream)', () => {
    fix = makeFixtureRepo([PRD('# body\n')]);
    const db = computeDashboard(fix.repoPath, 'E1', EPIC);
    expect(db.stages[0]).toEqual({ stage: 'prd', glyph: '✓' });
  });

  it('marks architecture as "⚠" when prd_tree_hash diverges from current PRD', () => {
    fix = makeFixtureRepo([
      PRD('# body v1\n'),
      ARCH('# arch body\n', { prd_tree_hash: 'cafebabecafebabe' /* stale */ }),
    ]);
    const db = computeDashboard(fix.repoPath, 'E1', EPIC);
    const arch = db.stages.find((s) => s.stage === 'architecture');
    expect(arch?.glyph).toBe('⚠');
    expect(db.staleCount).toBe(1);
  });

  it('marks architecture as "✓" when prd_tree_hash matches current PRD', () => {
    fix = makeFixtureRepo([PRD('# body v1\n')]);
    const prdHash = getStageTreeHash(fix.repoPath, 'E1', 'docs/prd')!;
    expect(prdHash).toMatch(/^[0-9a-f]{16}$/);

    commitMore(fix, [ARCH('# arch\n', { prd_tree_hash: prdHash })]);
    const db = computeDashboard(fix.repoPath, 'E1', EPIC);
    const arch = db.stages.find((s) => s.stage === 'architecture');
    expect(arch?.glyph).toBe('✓');
    expect(db.staleCount).toBe(0);
  });
});

describe('annotateArtifactStates', () => {
  let fix: Fixture | null = null;
  afterEach(() => { fix?.cleanup(); fix = null; });

  it('flags downstream as stale when upstream hash diverges', () => {
    fix = makeFixtureRepo([
      PRD('# v1\n'),
      ARCH('# arch\n', { prd_tree_hash: 'deadbeefdeadbeef' }),
    ]);
    const raw = scanEpicArtifacts(fix.repoPath, 'E1');
    const annotated = annotateArtifactStates(fix.repoPath, 'E1', raw);
    const arch = annotated.find((a) => a.stage === 'architecture');
    expect(arch?.state).toBe('stale');
  });

  it('leaves stages alone when there is no upstream ref', () => {
    fix = makeFixtureRepo([PRD('# v1\n')]);
    const raw = scanEpicArtifacts(fix.repoPath, 'E1');
    const annotated = annotateArtifactStates(fix.repoPath, 'E1', raw);
    const prd = annotated.find((a) => a.stage === 'prd');
    expect(prd?.state).toBe('ok');
  });
});
