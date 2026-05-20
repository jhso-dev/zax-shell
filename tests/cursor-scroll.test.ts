/**
 * Headless tests for the cursor + viewport invariants by replicating the
 * pure derivation logic that the React hook uses. We intentionally don't
 * mount React; the hook's state-updates are simulated with two local vars.
 *
 * If we ever rewrite useCursorScroll, these tests describe the contract.
 */
import { describe, it, expect } from 'vitest';

const clamp = (n: number, lo: number, hi: number) =>
  hi < lo ? lo : Math.max(lo, Math.min(hi, n));

// Simulate the hook's state machine for tests.
function makeMachine<T>(items: T[], viewportRows: number) {
  let cursor = 0;
  let viewportStart = 0;

  const normalize = () => {
    const len = items.length;
    const vr = Math.max(1, viewportRows);
    const maxStart = Math.max(0, len - vr);
    cursor = len === 0 ? 0 : clamp(cursor, 0, len - 1);
    if (cursor < viewportStart) viewportStart = cursor;
    if (cursor >= viewportStart + vr) viewportStart = cursor - vr + 1;
    viewportStart = clamp(viewportStart, 0, maxStart);
  };

  const api = {
    state() { normalize(); return { cursor, viewportStart, visible: items.slice(viewportStart, viewportStart + viewportRows) }; },
    moveDown() {
      normalize();
      const len = items.length;
      const vr = Math.max(1, viewportRows);
      const maxStart = Math.max(0, len - vr);
      if (len === 0) return;
      if (cursor === len - 1) { cursor = 0; viewportStart = 0; return; }
      cursor++;
      if (cursor >= viewportStart + vr) viewportStart = clamp(cursor - vr + 1, 0, maxStart);
    },
    moveUp() {
      normalize();
      const len = items.length;
      const vr = Math.max(1, viewportRows);
      const maxStart = Math.max(0, len - vr);
      if (len === 0) return;
      if (cursor === 0) { cursor = len - 1; viewportStart = maxStart; return; }
      cursor--;
      if (cursor < viewportStart) viewportStart = cursor;
    },
    resize(newRows: number) { viewportRows = newRows; normalize(); },
    setItems(next: T[]) { items = next; normalize(); },
    jumpTo(i: number) {
      const len = items.length;
      const vr = Math.max(1, viewportRows);
      const maxStart = Math.max(0, len - vr);
      cursor = clamp(i, 0, Math.max(0, len - 1));
      if (cursor < viewportStart) viewportStart = cursor;
      if (cursor >= viewportStart + vr) viewportStart = cursor - vr + 1;
      viewportStart = clamp(viewportStart, 0, maxStart);
    },
  };
  return api;
}

const seq = (n: number) => Array.from({ length: n }, (_, i) => `item-${i}`);

describe('cursor-scroll invariants', () => {
  it('default cursor is the first item', () => {
    const m = makeMachine(seq(10), 5);
    expect(m.state().cursor).toBe(0);
    expect(m.state().viewportStart).toBe(0);
  });

  it('moveDown advances cursor; viewport scrolls when cursor leaves it', () => {
    const m = makeMachine(seq(10), 5);
    for (let i = 0; i < 4; i++) m.moveDown();   // cursor 0→4, all within viewport
    expect(m.state()).toMatchObject({ cursor: 4, viewportStart: 0 });
    m.moveDown();                                // cursor → 5, viewport scrolls
    expect(m.state()).toMatchObject({ cursor: 5, viewportStart: 1 });
  });

  it('moveDown at last item wraps to first AND scrolls viewport to top', () => {
    const m = makeMachine(seq(30), 5);
    for (let i = 0; i < 29; i++) m.moveDown();   // cursor → 29
    expect(m.state().cursor).toBe(29);
    expect(m.state().viewportStart).toBe(25);
    m.moveDown();                                // wrap
    expect(m.state().cursor).toBe(0);
    expect(m.state().viewportStart).toBe(0);
  });

  it('moveUp at first item wraps to last AND scrolls viewport to bottom', () => {
    const m = makeMachine(seq(30), 5);
    expect(m.state().cursor).toBe(0);
    m.moveUp();                                  // wrap
    expect(m.state().cursor).toBe(29);
    expect(m.state().viewportStart).toBe(25);
  });

  it('keeps cursor visible after window shrinks (resize down)', () => {
    const m = makeMachine(seq(30), 10);
    for (let i = 0; i < 15; i++) m.moveDown();   // cursor → 15
    expect(m.state()).toMatchObject({ cursor: 15, viewportStart: 6 });
    m.resize(4);                                  // window 10 → 4
    const s = m.state();
    // cursor must remain visible
    expect(s.cursor).toBe(15);
    expect(s.viewportStart).toBeLessThanOrEqual(15);
    expect(s.viewportStart + 4).toBeGreaterThan(15);
  });

  it('keeps cursor visible after window grows (resize up)', () => {
    const m = makeMachine(seq(30), 4);
    for (let i = 0; i < 20; i++) m.moveDown();
    m.resize(15);
    const s = m.state();
    expect(s.cursor).toBe(20);
    expect(s.viewportStart).toBeLessThanOrEqual(20);
    expect(s.viewportStart + 15).toBeGreaterThan(20);
  });

  it('handles items shrinking out from under cursor', () => {
    const m = makeMachine(seq(30), 5);
    for (let i = 0; i < 25; i++) m.moveDown();   // cursor → 25
    m.setItems(seq(10));                          // shrink to 10
    const s = m.state();
    expect(s.cursor).toBeLessThan(10);
    expect(s.viewportStart).toBeGreaterThanOrEqual(0);
  });

  it('empty list keeps cursor=0 and is safe to call ops on', () => {
    const m = makeMachine<string>([], 5);
    expect(m.state()).toMatchObject({ cursor: 0, viewportStart: 0, visible: [] });
    m.moveDown(); m.moveUp(); m.jumpTo(99);
    expect(m.state()).toMatchObject({ cursor: 0, viewportStart: 0 });
  });

  it('jumpTo clamps and keeps cursor visible', () => {
    const m = makeMachine(seq(30), 5);
    m.jumpTo(999);
    expect(m.state().cursor).toBe(29);
    expect(m.state().viewportStart).toBe(25);
    m.jumpTo(-5);
    expect(m.state().cursor).toBe(0);
    expect(m.state().viewportStart).toBe(0);
  });

  it('full round-trip: 30 items, 5-row viewport, walk down then wrap, walk up then wrap', () => {
    const m = makeMachine(seq(30), 5);
    for (let i = 0; i < 30; i++) m.moveDown();   // 29 → wrap to 0
    expect(m.state()).toMatchObject({ cursor: 0, viewportStart: 0 });
    m.moveUp();                                   // 0 → wrap to 29
    expect(m.state()).toMatchObject({ cursor: 29, viewportStart: 25 });
  });
});
