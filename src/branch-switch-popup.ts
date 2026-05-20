/**
 * Centered tmux popup for picking a branch to switch a worktree to.
 *
 * Inputs (env vars set by daemon):
 *   ZAX_BRANCH_TITLE   — first line of header, e.g. "HGNN-13115"
 *   ZAX_BRANCH_CURRENT — currently checked-out ref (highlighted in list)
 *   ZAX_BRANCH_LIST    — newline-separated candidate refs
 *   ZAX_BRANCH_OUT     — absolute path; popup writes the chosen ref here
 */

import { writeFileSync, unlinkSync } from 'node:fs';

const out = process.stdout;
const inp = process.stdin;

const title    = process.env.ZAX_BRANCH_TITLE   ?? '';
const current  = process.env.ZAX_BRANCH_CURRENT ?? '';
const listEnv  = process.env.ZAX_BRANCH_LIST    ?? '';
const outFile  = process.env.ZAX_BRANCH_OUT     ?? '';
const items    = listEnv.split('\n').map((s) => s.trim()).filter(Boolean);

const C = {
  reset:   '\x1b[0m',
  title:   '\x1b[1;36m',
  cur:     '\x1b[1;32m',
  active:  '\x1b[7m',
  dim:     '\x1b[2m',
  arrow:   '\x1b[1;36m',
};

inp.setRawMode(true);
inp.resume();
out.write('\x1b[?25l');
const restore = () => out.write('\x1b[?25h');
process.on('exit', restore);

let cursor = Math.max(0, items.findIndex((r) => r === current));
if (cursor < 0) cursor = 0;

function render(): void {
  out.write('\x1b[2J\x1b[H');
  out.write('\n');
  out.write(`  ${C.title}브랜치 전환  ·  ${title}${C.reset}\n`);
  if (current) out.write(`  ${C.dim}현재:${C.reset} ${C.cur}${current}${C.reset}\n`);
  out.write('\n');
  items.forEach((r, i) => {
    const isCur = r === current;
    const marker = i === cursor ? `${C.arrow}▶${C.reset} ` : '  ';
    const tag = isCur ? `${C.cur}●${C.reset} ` : '  ';
    const text = i === cursor ? `${C.active} ${r} ${C.reset}` : r;
    out.write(`  ${marker}${tag}${text}\n`);
  });
  out.write('\n');
  out.write(`  ${C.dim}↑↓  ·  Enter 선택  ·  q / Esc 취소${C.reset}\n`);
}

function commit(ref: string): never {
  try {
    if (outFile) writeFileSync(outFile, ref, 'utf8');
  } catch {}
  process.exit(0);
}

function cancel(): never {
  try { if (outFile) unlinkSync(outFile); } catch {}
  process.exit(1);
}

render();

inp.on('data', (d) => {
  const ch = d.toString();
  if (ch === '\x1b[A' || ch === 'k') { cursor = (cursor - 1 + items.length) % items.length; render(); return; }
  if (ch === '\x1b[B' || ch === 'j') { cursor = (cursor + 1) % items.length; render(); return; }
  if (ch === '\r' || ch === '\n') {
    const chosen = items[cursor];
    if (chosen) commit(chosen); else cancel();
    return;
  }
  if (ch === 'q' || ch === 'Q' || ch === '\x1b' || ch === '\x03') cancel();
});
