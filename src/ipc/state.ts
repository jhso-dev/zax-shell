import { homedir } from 'node:os';
import { join } from 'node:path';

export const STATE_DIR = process.env.ZAX_SHELL_STATE_DIR
  ?? join(homedir(), '.zax-shell', 'state');
export const STATE_FILE = join(STATE_DIR, 'state.json');
export const EVENTS_FILE = join(STATE_DIR, 'events.jsonl');

export interface Epic {
  key: string;
  summary: string;
  status: string;
  url?: string;
  folder?: string;
  /** Set only when this epic lives exclusively on a feat branch ref. */
  branch?: string;
  worktreePath?: string;
}

export interface Artifact {
  path: string;
  stage: 'prd' | 'architecture' | 'spec' | 'test-case' | 'other';
  state: 'ok' | 'drift' | 'stale' | 'missing';
  treeHash?: string;
  upstreamHash?: string;
}

export interface StageStatus {
  stage: 'prd' | 'architecture' | 'spec' | 'test-case';
  glyph: '✓' | '◐' | '⚠' | '·';
  treeHash?: string;
}

export interface Dashboard {
  epicKey?: string;
  epicSummary?: string;
  stages: StageStatus[];
  driftCount: number;
  staleCount: number;
  updatedAt: string;
}

export interface Toast {
  id: string;
  level: 'info' | 'success' | 'warn' | 'error';
  text: string;
  createdAt: string;
  pane?: 'epics' | 'hub';
}

export interface ExternalHealth {
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
  artifacts: Record<string, Artifact[]>;
  dashboard?: Dashboard;
  /** "loading" | "ok" | "error: ..." */
  jiraStatus: string;
  productHubPath: string;
  productHubExists: boolean;
  toast?: Toast;
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
  | { type: 'refresh-jira' }
  | { type: 'refresh-hub' }
  | { type: 'quit' }
  | { type: 'kill-all' }
  | { type: 'confirm-quit' }
  | { type: 'show-help' }
  | { type: 'switch-branch'; epicKey: string }
  | { type: 'open-browser'; url: string }
  | { type: 'jira-search'; query: string }
  | { type: 'jira-search-clear' };
