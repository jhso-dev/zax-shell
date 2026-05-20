import { useCallback, useEffect, useState } from 'react';

/**
 * A self-correcting cursor + viewport manager for vertical lists.
 *
 * Invariants on every render:
 *  - 0 <= cursor < items.length  (or cursor === 0 when items is empty)
 *  - viewportStart <= cursor < viewportStart + viewportRows  (cursor visible)
 *  - 0 <= viewportStart <= max(0, items.length - viewportRows)
 *
 * Behavior:
 *  - down at last item → wraps to first (viewport resets to top)
 *  - up at first item  → wraps to last  (viewport jumps to bottom)
 *  - pageUp / pageDown → bounded movement (no wrap)
 *  - items shrink or viewportRows changes → cursor/viewport re-clamped silently
 */
export interface CursorScroll<T> {
  cursor: number;
  viewportStart: number;
  visible: T[];
  /** number of items hidden above the viewport */
  before: number;
  /** number of items hidden below the viewport */
  after: number;
  moveUp: () => void;
  moveDown: () => void;
  pageUp: () => void;
  pageDown: () => void;
  toTop: () => void;
  toBottom: () => void;
  /** Jump to an absolute index (clamped). */
  jumpTo: (index: number) => void;
}

const clamp = (n: number, lo: number, hi: number) =>
  hi < lo ? lo : Math.max(lo, Math.min(hi, n));

export function useCursorScroll<T>(
  items: T[],
  viewportRows: number,
): CursorScroll<T> {
  const [cursorState, setCursorState] = useState(0);
  const [vsState, setVsState] = useState(0);

  const len = items.length;
  const vr = Math.max(1, viewportRows);
  const maxStart = Math.max(0, len - vr);

  // ── derive effective values that always satisfy the invariants ──────────
  const cursor = len === 0 ? 0 : clamp(cursorState, 0, len - 1);
  let viewportStart = clamp(vsState, 0, maxStart);
  if (cursor < viewportStart) viewportStart = cursor;
  if (cursor >= viewportStart + vr) viewportStart = cursor - vr + 1;
  viewportStart = clamp(viewportStart, 0, maxStart);

  // Sync state if the effective values diverged (caused by items shrink
  // or viewportRows changing). Done in an effect to avoid stale state on
  // subsequent operations.
  useEffect(() => {
    if (cursor !== cursorState) setCursorState(cursor);
    if (viewportStart !== vsState) setVsState(viewportStart);
  }, [cursor, cursorState, viewportStart, vsState]);

  // ── operations ──────────────────────────────────────────────────────────
  const moveDown = useCallback(() => {
    if (len === 0) return;
    if (cursor === len - 1) {
      setCursorState(0);
      setVsState(0);
      return;
    }
    const c = cursor + 1;
    setCursorState(c);
    if (c >= viewportStart + vr) setVsState(clamp(c - vr + 1, 0, maxStart));
  }, [cursor, viewportStart, vr, len, maxStart]);

  const moveUp = useCallback(() => {
    if (len === 0) return;
    if (cursor === 0) {
      const c = len - 1;
      setCursorState(c);
      setVsState(maxStart);
      return;
    }
    const c = cursor - 1;
    setCursorState(c);
    if (c < viewportStart) setVsState(c);
  }, [cursor, viewportStart, len, maxStart]);

  const jumpTo = useCallback((index: number) => {
    if (len === 0) return;
    const c = clamp(index, 0, len - 1);
    setCursorState(c);
    setVsState((s) => {
      let ns = clamp(s, 0, maxStart);
      if (c < ns) ns = c;
      if (c >= ns + vr) ns = c - vr + 1;
      return clamp(ns, 0, maxStart);
    });
  }, [len, vr, maxStart]);

  const pageDown = useCallback(() => {
    if (len === 0) return;
    jumpTo(cursor + Math.max(1, vr - 1));
  }, [cursor, vr, len, jumpTo]);

  const pageUp = useCallback(() => {
    if (len === 0) return;
    jumpTo(cursor - Math.max(1, vr - 1));
  }, [cursor, vr, len, jumpTo]);

  const toTop = useCallback(() => jumpTo(0), [jumpTo]);
  const toBottom = useCallback(() => jumpTo(len - 1), [jumpTo, len]);

  // ── derived view ────────────────────────────────────────────────────────
  const end = Math.min(len, viewportStart + vr);
  const visible = items.slice(viewportStart, end);
  const before = viewportStart;
  const after = Math.max(0, len - end);

  return {
    cursor, viewportStart, visible, before, after,
    moveUp, moveDown, pageUp, pageDown, toTop, toBottom, jumpTo,
  };
}
