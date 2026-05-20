/**
 * Terminal cell width for a string. CJK characters and fullwidth forms
 * occupy 2 cells; everything else (including ASCII, Latin extended, the
 * box-drawing glyphs we use, and emoji-as-text variants) is treated as 1.
 *
 * Good enough for our row layout — not a full wcwidth. Emoji w/ ZWJ
 * sequences are rare in epic titles and would only over-count by a cell.
 */
/**
 * East-Asian Ambiguous glyphs that we use in the UI. In a CJK locale terminal
 * these render as 2 cells even though Unicode marks them as ambiguous. We
 * conservatively treat them as 2 cells everywhere — a row that's 1 cell
 * narrower than possible is better than a row that wraps to two lines.
 */
const WIDE_GLYPHS = new Set<number>([
  0x2502,  // │  box drawings light vertical
  0x2500,  // ─  box drawings light horizontal
  0x2588,  // █  full block
  0x258C,  // ▌  left half block
  0x2590,  // ▐  right half block
  0x25B6,  // ▶  black right-pointing triangle
  0x25C0,  // ◀  black left-pointing triangle
  0x25CB,  // ○  white circle
  0x25CF,  // ●  black circle
  0x25D0,  // ◐  circle with left half black
  0x2713,  // ✓  check mark
  0x2717,  // ✗  ballot x
  0x2718,  // ✘
  0x26A0,  // ⚠  warning sign
  0x2192,  // →  rightwards arrow
  0x2190,  // ←
  0x2191,  // ↑
  0x2193,  // ↓
  0x21B5,  // ↵
  0x25CC,  // ◌  dotted circle
  0x2026,  // …  horizontal ellipsis
]);

export function cellWidth(s: string): number {
  let w = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (
      (c >= 0x1100 && c <= 0x115F) ||   // Hangul Jamo
      (c >= 0x2E80 && c <= 0x9FFF) ||   // CJK Radicals … Unified Ideographs
      (c >= 0xA000 && c <= 0xA4CF) ||   // Yi
      (c >= 0xAC00 && c <= 0xD7A3) ||   // Hangul Syllables
      (c >= 0xF900 && c <= 0xFAFF) ||   // CJK Compatibility Ideographs
      (c >= 0xFE30 && c <= 0xFE4F) ||   // CJK Compatibility Forms
      (c >= 0xFF00 && c <= 0xFF60) ||   // Fullwidth Forms
      (c >= 0xFFE0 && c <= 0xFFE6) ||   // Fullwidth signs
      WIDE_GLYPHS.has(c)
    ) {
      w += 2;
    } else {
      w += 1;
    }
  }
  return w;
}

/** Truncate a string so its display width does not exceed maxWidth (cells). */
export function truncateToWidth(s: string, maxWidth: number): string {
  if (maxWidth <= 0) return '';
  let w = 0;
  let out = '';
  for (const ch of s) {
    const cw = cellWidth(ch);
    if (w + cw > maxWidth) return out;
    out += ch;
    w += cw;
  }
  return out;
}

/** Pad (or truncate) so the final cell width equals exactly width. */
export function padToWidth(s: string, width: number): string {
  if (width <= 0) return '';
  const w = cellWidth(s);
  if (w >= width) return truncateToWidth(s, width);
  return s + ' '.repeat(width - w);
}
