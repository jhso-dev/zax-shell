import { homedir } from 'node:os';
import { join } from 'node:path';

export const STATE_DIR = process.env.ZAX_SHELL_STATE_DIR
  ?? join(homedir(), '.cache', 'zax-shell');
export const STATE_FILE = join(STATE_DIR, 'state.json');
export const EVENTS_FILE = join(STATE_DIR, 'events.jsonl');

export interface Epic {
  key: string;
  summary: string;
  status: string;
  url?: string;
  folder?: string;
  /** Set when the folder lives only on a feat branch ref (e.g. "origin/feat/HGNN-13115/spec"). */
  branch?: string;
  /** Materialized worktree path when `branch` is set and the user has selected the epic. */
  worktreePath?: string;
}

export interface Artifact {
  /** Path relative to the epic folder. */
  path: string;
  stage: 'prd' | 'architecture' | 'spec' | 'test-case' | 'other';
  /** "ok" | "drift" | "stale" | "missing" */
  state: 'ok' | 'drift' | 'stale' | 'missing';
  treeHash?: string;
  upstreamHash?: string;
}

export interface StageStatus {
  stage: 'prd' | 'architecture' | 'spec' | 'test-case';
  /** "✓" present and fresh, "◐" present but drift, "⚠" stale, "·" missing */
  glyph: '✓' | '◐' | '⚠' | '·';
  treeHash?: string;
}

export interface Dashboard {
  epicKey?: string;
  epicSummary?: string;
  stages: StageStatus[];
  driftCount: number;
  staleCount: number;
  /** ISO timestamp of last refresh. */
  updatedAt: string;
}

export interface Toast {
  id: string;
  /** "info" | "success" | "warn" | "error" */
  level: 'info' | 'success' | 'warn' | 'error';
  text: string;
  /** ISO timestamp — used by panes to fade out after ~3s. */
  createdAt: string;
}

export interface ExternalHealth {
  /** "ok" | "missing" | "unauthed" | "checking" */
  acli: 'ok' | 'missing' | 'unauthed' | 'checking';
  gh:   'ok' | 'missing' | 'unauthed' | 'checking';
}

export interface EpicSearch {
  query: string;
  status: 'loading' | 'ok' | 'error';
  results: Epic[];
  message?: string;
}

export interface SharedState {
  version: 1;
  epics: Epic[];
  selectedEpic?: string;
  artifacts: Record<string /* epicKey */, Artifact[]>;
  dashboard?: Dashboard;
  /** "loading" | "ok" | "error: ..." */
  jiraStatus: string;
  productHubPath: string;
  productHubExists: boolean;
  /** Most recent transient message. */
  toast?: Toast;
  /** acli / gh auth health. Updated every few minutes. */
  health?: ExternalHealth;
  epicSearch?: EpicSearch;
  updatedAt: string;
}

export const initialState = (productHubPath: string): SharedState => ({
  version: 1,
  epics: [],
  selectedEpic: undefined,
  artifacts: {},
  dashboard: undefined,
  jiraStatus: 'loading',
  productHubPath,
  productHubExists: false,
  updatedAt: new Date().toISOString(),
});

export type Event =
  | { type: 'select-epic'; epicKey: string }
  | { type: 'open-file'; absPath: string }
  | { type: 'refresh' }
  | { type: 'sync-hub' }
  | { type: 'quit' }
  | { type: 'kill-all' }
  | { type: 'confirm-quit' }
  | { type: 'show-help' }
  | { type: 'show-jira-detail'; epicKey: string }
  | { type: 'show-gh-dash'; epicKey: string }
  | { type: 'open-browser'; url: string }
  | { type: 'jira-search'; query: string }
  | { type: 'jira-search-clear' };
