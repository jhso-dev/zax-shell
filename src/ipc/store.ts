import {
  mkdirSync, writeFileSync, readFileSync, watchFile, unwatchFile,
  existsSync, appendFileSync, renameSync, statSync, openSync, readSync, closeSync,
} from 'node:fs';
import { dirname } from 'node:path';
import {
  STATE_FILE, EVENTS_FILE,
  type SharedState, type Event, initialState,
} from './state.js';

const ensureDir = (path: string) => {
  if (!existsSync(dirname(path))) mkdirSync(dirname(path), { recursive: true });
};

/** Atomically write shared state JSON. Writers (daemon) call this. */
export function writeState(state: SharedState): void {
  ensureDir(STATE_FILE);
  const tmp = STATE_FILE + '.tmp';
  writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8');
  renameSync(tmp, STATE_FILE);
}

export function readState(productHubPath: string): SharedState {
  if (!existsSync(STATE_FILE)) return initialState(productHubPath);
  try {
    return JSON.parse(readFileSync(STATE_FILE, 'utf8')) as SharedState;
  } catch {
    return initialState(productHubPath);
  }
}

/**
 * Watch the state file. Readers (panes) call this.
 *
 * Uses `fs.watchFile` (polling) instead of `fs.watch` because writeState does
 * an atomic rename and `fs.watch` on macOS loses the file after rename.
 */
export function subscribeState(
  productHubPath: string,
  onChange: (s: SharedState) => void,
): () => void {
  ensureDir(STATE_FILE);
  if (!existsSync(STATE_FILE)) writeState(initialState(productHubPath));

  onChange(readState(productHubPath));

  const listener = () => onChange(readState(productHubPath));
  watchFile(STATE_FILE, { interval: 150, persistent: true }, listener);
  return () => unwatchFile(STATE_FILE, listener);
}

/** Append an event from a pane. Daemon tails this file. */
export function emitEvent(ev: Event): void {
  ensureDir(EVENTS_FILE);
  appendFileSync(EVENTS_FILE, JSON.stringify(ev) + '\n', 'utf8');
}

/** Tail events.jsonl. Daemon calls this. */
export function subscribeEvents(onEvent: (ev: Event) => void): () => void {
  ensureDir(EVENTS_FILE);
  if (!existsSync(EVENTS_FILE)) writeFileSync(EVENTS_FILE, '', 'utf8');

  let lastSize = 0;
  try { lastSize = statSync(EVENTS_FILE).size; } catch {}

  const poll = () => {
    try {
      const size = statSync(EVENTS_FILE).size;
      if (size > lastSize) {
        const buf = Buffer.alloc(size - lastSize);
        const fd = openSync(EVENTS_FILE, 'r');
        readSync(fd, buf, 0, size - lastSize, lastSize);
        closeSync(fd);
        lastSize = size;
        for (const line of buf.toString('utf8').split('\n')) {
          if (!line.trim()) continue;
          try { onEvent(JSON.parse(line) as Event); } catch {}
        }
      } else if (size < lastSize) {
        lastSize = size;
      }
    } catch {}
  };

  watchFile(EVENTS_FILE, { interval: 120, persistent: true }, poll);
  return () => unwatchFile(EVENTS_FILE, poll);
}
