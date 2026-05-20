import { describe, it, expect, afterEach } from 'vitest';
import { listEpicFolders, scanEpicArtifacts } from '../src/product-hub/scanner.js';
import { makeFixtureRepo, type Fixture } from './helpers/fixture-repo.js';

describe('listEpicFolders', () => {
  let fix: Fixture | null = null;
  afterEach(() => { fix?.cleanup(); fix = null; });

  it('returns immediate subdirectories of epics/', () => {
    fix = makeFixtureRepo([
      { path: 'epics/B2C-1-foo/README.md', body: '# foo\n' },
      { path: 'epics/HGNN-2-bar/README.md', body: '# bar\n' },
    ]);
    const folders = listEpicFolders(fix.repoPath).sort();
    expect(folders).toEqual(['B2C-1-foo', 'HGNN-2-bar']);
  });

  it('returns [] when epics/ missing', () => {
    fix = makeFixtureRepo([{ path: 'README.md', body: '# x\n' }]);
    expect(listEpicFolders(fix.repoPath)).toEqual([]);
  });
});

describe('scanEpicArtifacts', () => {
  let fix: Fixture | null = null;
  afterEach(() => { fix?.cleanup(); fix = null; });

  it('finds stage files and sorts by stage order', () => {
    fix = makeFixtureRepo([
      { path: 'epics/E1/artifacts/spec/spec.md',          frontmatter: { type: 'spec' },         body: 's\n' },
      { path: 'epics/E1/docs/prd/prd.md',                 frontmatter: { type: 'prd' },          body: 'p\n' },
      { path: 'epics/E1/artifacts/architecture/architecture.md', frontmatter: { type: 'arch' }, body: 'a\n' },
      { path: 'epics/E1/artifacts/test-case/test-case.md',frontmatter: { type: 'tc' },           body: 't\n' },
    ]);
    const arts = scanEpicArtifacts(fix.repoPath, 'E1');
    expect(arts.map((a) => a.stage)).toEqual(['prd', 'architecture', 'spec', 'test-case']);
  });

  it('excludes changelog.md from prd', () => {
    fix = makeFixtureRepo([
      { path: 'epics/E1/docs/prd/prd.md',       frontmatter: { type: 'prd' }, body: 'p\n' },
      { path: 'epics/E1/docs/prd/changelog.md', body: '# changelog\n' },
    ]);
    const arts = scanEpicArtifacts(fix.repoPath, 'E1');
    expect(arts.find((a) => a.path.endsWith('changelog.md'))).toBeUndefined();
    expect(arts.find((a) => a.path.endsWith('prd.md'))).toBeDefined();
  });

  it('returns [] for nonexistent folder', () => {
    fix = makeFixtureRepo([{ path: 'README.md', body: 'x\n' }]);
    expect(scanEpicArtifacts(fix.repoPath, 'NOPE')).toEqual([]);
  });

  it('reads tree_hash from frontmatter when present', () => {
    fix = makeFixtureRepo([
      {
        path: 'epics/E1/docs/prd/prd.md',
        frontmatter: { type: 'prd', tree_hash: 'deadbeefdeadbeef' },
        body: 'p\n',
      },
    ]);
    const arts = scanEpicArtifacts(fix.repoPath, 'E1');
    expect(arts[0]?.treeHash).toBe('deadbeefdeadbeef');
  });
});
