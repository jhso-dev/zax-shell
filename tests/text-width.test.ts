import { describe, it, expect } from 'vitest';
import { cellWidth, truncateToWidth, padToWidth } from '../src/ui/text-width.js';

describe('cellWidth', () => {
  it('ASCII chars count as 1', () => {
    expect(cellWidth('hello')).toBe(5);
    expect(cellWidth('B2C-50734')).toBe(9);
  });

  it('Korean syllables count as 2', () => {
    expect(cellWidth('직방')).toBe(4);
    expect(cellWidth('가나다')).toBe(6);
  });

  it('mixed strings sum correctly', () => {
    expect(cellWidth('B2C 직방 hero')).toBe(3 + 1 + 4 + 1 + 4);
  });

  it('East-Asian-Ambiguous UI glyphs (▶ █ ● │) count as 2 cells', () => {
    // These render as wide in CJK-configured terminals; we conservatively
    // count them as 2 so row layouts never overflow on Korean macOS setups.
    expect(cellWidth('▶')).toBe(2);
    expect(cellWidth('█')).toBe(2);
    expect(cellWidth('●')).toBe(2);
    expect(cellWidth('│')).toBe(2);
  });
});

describe('truncateToWidth', () => {
  it('returns the whole string if it fits', () => {
    expect(truncateToWidth('hello', 10)).toBe('hello');
  });

  it('truncates ASCII to exact width', () => {
    expect(truncateToWidth('abcdefghij', 5)).toBe('abcde');
  });

  it('truncates without splitting a CJK char (no partial cells)', () => {
    // "직방" is 4 cells, max 3 → must drop the second char
    expect(truncateToWidth('직방', 3)).toBe('직');
    expect(truncateToWidth('직방', 4)).toBe('직방');
    expect(truncateToWidth('직방', 1)).toBe('');
  });

  it('handles mixed scripts', () => {
    // "abc직방" cell-widths: 1,1,1,2,2 = 7 total
    expect(truncateToWidth('abc직방', 5)).toBe('abc직');
    expect(truncateToWidth('abc직방', 4)).toBe('abc');
  });

  it('returns empty for non-positive widths', () => {
    expect(truncateToWidth('hello', 0)).toBe('');
    expect(truncateToWidth('hello', -3)).toBe('');
  });
});

describe('padToWidth', () => {
  it('pads ASCII to exact width', () => {
    expect(padToWidth('abc', 5)).toBe('abc  ');
  });

  it('counts CJK as 2 when padding', () => {
    expect(padToWidth('직', 4)).toBe('직  ');   // 2 cells + 2 spaces = 4
  });

  it('truncates when already too wide', () => {
    expect(padToWidth('abcdef', 4)).toBe('abcd');
    expect(padToWidth('직방가', 4)).toBe('직방');
  });
});
