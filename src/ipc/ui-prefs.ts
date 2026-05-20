import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { STATE_DIR } from './state.js';

const FILE = join(STATE_DIR, 'ui-prefs.json');

export interface UiPrefs {
  selectedEpicKey?: string;
  query?: string;
  projectFilter?: string | null;
  sortMode?: 'updated' | 'key' | 'status';
  /** Last seen tmux window layout string (output of `#{window_layout}`). */
  tmuxLayout?: string;
}

const DEFAULTS: UiPrefs = {
  selectedEpicKey: undefined,
  query: '',
  projectFilter: null,
  sortMode: 'updated',
  tmuxLayout: undefined,
};

export function loadPrefs(): UiPrefs {
  if (!existsSync(FILE)) return { ...DEFAULTS };
  try {
    return { ...DEFAULTS, ...JSON.parse(readFileSync(FILE, 'utf8')) };
  } catch {
    return { ...DEFAULTS };
  }
}

let writeTimer: NodeJS.Timeout | undefined;
let pending: UiPrefs | null = null;

export function savePrefs(next: Partial<UiPrefs>): void {
  pending = { ...(pending ?? loadPrefs()), ...next };
  if (writeTimer) clearTimeout(writeTimer);
  writeTimer = setTimeout(() => {
    if (!pending) return;
    if (!existsSync(dirname(FILE))) mkdirSync(dirname(FILE), { recursive: true });
    writeFileSync(FILE, JSON.stringify(pending, null, 2), 'utf8');
    pending = null;
  }, 250);
}
