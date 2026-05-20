import type { Dashboard, Epic, StageStatus, Artifact } from '../ipc/state.js';
import { findStageFile, readFm, type Stage } from './frontmatter.js';
import { getStageTreeHash, type StageDir } from './tree-hash.js';

const STAGE_DIR: Record<Stage, StageDir> = {
  prd: 'docs/prd',
  architecture: 'artifacts/architecture',
  spec: 'artifacts/spec',
  'test-case': 'artifacts/test-case',
};

/** Upstream stage hash field name on each downstream stage. */
const UPSTREAMS: Record<Stage, Array<{ field: 'prd_tree_hash' | 'architecture_tree_hash' | 'spec_tree_hash'; stage: Stage }>> = {
  prd: [],
  architecture: [{ field: 'prd_tree_hash', stage: 'prd' }],
  spec: [
    { field: 'prd_tree_hash', stage: 'prd' },
    { field: 'architecture_tree_hash', stage: 'architecture' },
  ],
  'test-case': [
    { field: 'prd_tree_hash', stage: 'prd' },
    { field: 'architecture_tree_hash', stage: 'architecture' },
    { field: 'spec_tree_hash', stage: 'spec' },
  ],
};

const STAGES: Stage[] = ['prd', 'architecture', 'spec', 'test-case'];

/**
 * Compute Dashboard for the selected epic by walking each stage:
 *   - missing → '·'
 *   - present and all upstream tree-hash refs match current → '✓'
 *   - present but at least one upstream ref mismatches → '⚠' (stale)
 *   - present but file exists in working tree differently from origin/HEAD → '◐' drift
 */
export function computeDashboard(
  productHubPath: string,
  folder: string,
  epic: Epic,
): Dashboard {
  const stages: StageStatus[] = [];
  let driftCount = 0;
  let staleCount = 0;

  // Cache upstream hashes per stage.
  const upstreamCache = new Map<Stage, string | null>();
  const upstreamHash = (s: Stage): string | null => {
    if (upstreamCache.has(s)) return upstreamCache.get(s)!;
    const h = getStageTreeHash(productHubPath, folder, STAGE_DIR[s]);
    upstreamCache.set(s, h);
    return h;
  };

  for (const stage of STAGES) {
    const file = findStageFile(productHubPath, folder, stage);
    if (!file) {
      stages.push({ stage, glyph: '·' });
      continue;
    }

    const fm = readFm(file);
    const refs = UPSTREAMS[stage];

    let isStale = false;
    for (const { field, stage: upStage } of refs) {
      const stored = fm[field];
      const current = upstreamHash(upStage);
      if (current && stored && stored !== current) {
        isStale = true;
        break;
      }
    }

    if (isStale) {
      stages.push({ stage, glyph: '⚠' });
      staleCount++;
    } else {
      // Check own-stage drift: current tree-hash vs frontmatter-declared.
      const own = upstreamHash(stage);
      const ownField = (fm as any)[`${stage}_tree_hash`];
      if (own && ownField && own !== ownField) {
        stages.push({ stage, glyph: '◐' });
        driftCount++;
      } else {
        stages.push({ stage, glyph: '✓' });
      }
    }
  }

  return {
    epicKey: epic.key,
    epicSummary: epic.summary,
    stages,
    driftCount,
    staleCount,
    updatedAt: new Date().toISOString(),
  };
}

/** Annotate Artifact[] with per-file drift/stale state. */
export function annotateArtifactStates(
  productHubPath: string,
  folder: string,
  artifacts: Artifact[],
): Artifact[] {
  if (artifacts.length === 0) return artifacts;
  const cache = new Map<Stage, string | null>();
  const getH = (s: Stage): string | null => {
    if (cache.has(s)) return cache.get(s)!;
    const h = getStageTreeHash(productHubPath, folder, STAGE_DIR[s]);
    cache.set(s, h);
    return h;
  };

  return artifacts.map((a) => {
    if (a.stage === 'other') return a;
    const stage = a.stage as Stage;
    const refs = UPSTREAMS[stage];
    let isStale = false;
    let isDrift = false;

    // We need the file's frontmatter to compare hashes.
    const file = findStageFile(productHubPath, folder, stage);
    if (!file) return a;
    const fm = readFm(file);

    for (const { field, stage: upStage } of refs) {
      const stored = fm[field];
      const current = getH(upStage);
      if (current && stored && stored !== current) { isStale = true; break; }
    }
    if (!isStale) {
      const own = getH(stage);
      const ownField = (fm as any)[`${stage}_tree_hash`];
      if (own && ownField && own !== ownField) isDrift = true;
    }
    return {
      ...a,
      state: isStale ? 'stale' : isDrift ? 'drift' : 'ok',
      upstreamHash: getH(stage) ?? undefined,
    };
  });
}
