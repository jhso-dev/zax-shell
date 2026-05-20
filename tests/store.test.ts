import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

let stateDir: string;
beforeEach(() => {
  stateDir = mkdtempSync(join(tmpdir(), 'zax-shell-store-'));
  process.env.ZAX_SHELL_STATE_DIR = stateDir;
  vi.resetModules();
});
afterEach(() => {
  delete process.env.ZAX_SHELL_STATE_DIR;
  try { rmSync(stateDir, { recursive: true, force: true }); } catch {}
});

const fresh = async () => {
  const state = await import('../src/ipc/state.js');
  const store = await import('../src/ipc/store.js');
  return { state, store };
};

describe('writeState / readState', () => {
  it('roundtrips through state.json', async () => {
    const { state, store } = await fresh();
    const initial = state.initialState('/tmp/hub');
    store.writeState({
      ...initial,
      epics: [{ key: 'X-1', summary: 'foo', status: 'In Progress' }],
      jiraStatus: 'ok',
    });

    const stateFile = join(stateDir, 'state.json');
    expect(existsSync(stateFile)).toBe(true);
    const parsed = JSON.parse(readFileSync(stateFile, 'utf8'));
    expect(parsed.epics[0].key).toBe('X-1');

    const read = store.readState('/tmp/hub');
    expect(read.epics[0]?.key).toBe('X-1');
    expect(read.jiraStatus).toBe('ok');
  });

  it('writes atomically (no partial reads)', async () => {
    const { state, store } = await fresh();
    const initial = state.initialState('/tmp/hub');
    // Repeated writes with growing payloads; each readState must always parse.
    for (let i = 0; i < 20; i++) {
      const epics = Array.from({ length: i + 1 }, (_, j) => ({
        key: `E-${j}`, summary: 'x'.repeat(200), status: 'open',
      }));
      store.writeState({ ...initial, epics });
      const read = store.readState('/tmp/hub');
      expect(read.epics.length).toBe(i + 1);
    }
  });
});

describe('events: emit + subscribe', () => {
  it('delivers appended events to a tail subscriber', async () => {
    const { store } = await fresh();
    const received: any[] = [];
    const unsub = store.subscribeEvents((ev) => { received.push(ev); });

    // Wait for the watcher's first poll tick.
    await new Promise((r) => setTimeout(r, 150));

    store.emitEvent({ type: 'select-epic', epicKey: 'A' });
    await new Promise((r) => setTimeout(r, 250));
    store.emitEvent({ type: 'select-epic', epicKey: 'B' });
    await new Promise((r) => setTimeout(r, 250));
    store.emitEvent({ type: 'refresh' });
    await new Promise((r) => setTimeout(r, 400));
    unsub();

    const keys = received
      .filter((e) => e.type === 'select-epic')
      .map((e) => e.epicKey)
      .sort();
    expect(keys).toEqual(['A', 'B']);
    expect(received.some((e) => e.type === 'refresh')).toBe(true);
  });
});

describe('subscribeState', () => {
  it('emits initial value + change after write', async () => {
    const { state, store } = await fresh();
    const initial = state.initialState('/tmp/hub');
    store.writeState({ ...initial, jiraStatus: 'first' });

    const seen: string[] = [];
    const unsub = store.subscribeState('/tmp/hub', (s) => { seen.push(s.jiraStatus); });

    await new Promise((r) => setTimeout(r, 100));
    store.writeState({ ...initial, jiraStatus: 'second' });
    await new Promise((r) => setTimeout(r, 500));
    store.writeState({ ...initial, jiraStatus: 'third' });
    await new Promise((r) => setTimeout(r, 500));
    unsub();

    expect(seen[0]).toBe('first');
    expect(seen).toContain('second');
    expect(seen).toContain('third');
  });
});
