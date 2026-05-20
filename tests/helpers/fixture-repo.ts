import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const git = (cwd: string, args: string[]) =>
  execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString();

export interface FixtureFile {
  /** Path relative to repo root. */
  path: string;
  /** Optional YAML frontmatter object. */
  frontmatter?: Record<string, string>;
  /** Body content (no leading "---"). */
  body: string;
}

export interface Fixture {
  /** Local path of the working repo. */
  repoPath: string;
  /** Cleanup. */
  cleanup: () => void;
}

const serializeFm = (fm: Record<string, string>): string => {
  const lines = Object.entries(fm).map(([k, v]) => `${k}: ${v}`);
  return ['---', ...lines, '---', ''].join('\n');
};

/**
 * Build a local "origin" + checked-out clone. zax tree-hash reads
 * `origin/HEAD`, so we need a real remote ref.
 */
export function makeFixtureRepo(files: FixtureFile[]): Fixture {
  const root = mkdtempSync(join(tmpdir(), 'zax-shell-fix-'));
  const upstream = join(root, 'upstream.git');
  const work = join(root, 'product-hub');

  // Bare upstream
  mkdirSync(upstream, { recursive: true });
  git(upstream, ['init', '--bare', '-b', 'main', '-q']);

  // Working clone
  mkdirSync(work, { recursive: true });
  git(work, ['init', '-b', 'main', '-q']);
  git(work, ['config', 'user.email', 'test@example.com']);
  git(work, ['config', 'user.name', 'Test']);
  git(work, ['remote', 'add', 'origin', upstream]);

  for (const f of files) {
    const abs = join(work, f.path);
    mkdirSync(join(abs, '..'), { recursive: true });
    const content = (f.frontmatter ? serializeFm(f.frontmatter) : '') + f.body;
    writeFileSync(abs, content, 'utf8');
  }

  git(work, ['add', '-A']);
  git(work, ['commit', '-q', '-m', 'fixture']);
  git(work, ['push', '-q', 'origin', 'main']);

  // Create origin/HEAD ref pointing to main.
  git(upstream, ['symbolic-ref', 'HEAD', 'refs/heads/main']);
  git(work, ['fetch', '-q', 'origin']);
  git(work, ['remote', 'set-head', 'origin', 'main']);

  return {
    repoPath: work,
    cleanup: () => { try { rmSync(root, { recursive: true, force: true }); } catch {} },
  };
}

/**
 * Update files and push to upstream (so origin/HEAD moves).
 */
export function commitMore(fixture: Fixture, files: FixtureFile[], message = 'update'): void {
  for (const f of files) {
    const abs = join(fixture.repoPath, f.path);
    mkdirSync(join(abs, '..'), { recursive: true });
    const content = (f.frontmatter ? serializeFm(f.frontmatter) : '') + f.body;
    writeFileSync(abs, content, 'utf8');
  }
  git(fixture.repoPath, ['add', '-A']);
  git(fixture.repoPath, ['commit', '-q', '-m', message]);
  git(fixture.repoPath, ['push', '-q', 'origin', 'main']);
  git(fixture.repoPath, ['fetch', '-q', 'origin']);
}
