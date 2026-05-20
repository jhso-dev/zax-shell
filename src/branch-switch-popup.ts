/**
 * Centered tmux popup for picking a branch to switch a worktree to.
 *
 * tmux popups don't inherit our spawn() env (the tmux server has its
 * own), so inputs are read from a fixed file path the daemon writes
 * just before opening the popup.
 */

import { readFileSync, writeFileSync, unlinkSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

const STATE_DIR = process.env.ZAX_SHELL_STATE_DIR
  ?? join(homedir(), '.zax-shell', 'state');
const IN_FILE  = join(STATE_DIR, 'branch-input.json');
const OUT_FILE = join(STATE_DIR, 'branch-choice.txt');

interface Inputs { title: string; current: string; candidates: string[] }

function loadInputs(): Inputs {
  try { return JSON.parse(readFileSync(IN_FILE, 'utf8')) as Inputs; }
  catch { return { title: '', current: '', candidates: [] }; }
}

const { title, current, candidates: items } = loadInputs();

const out = process.stdout;
const inp = process.stdin;

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
  if (items.length === 0) {
    out.write(`  ${C.dim}(후보 없음 — origin/feat/${title}/* 가 없습니다)${C.reset}\n`);
  } else {
    items.forEach((r, i) => {
      const isCur = r === current;
      const marker = i === cursor ? `${C.arrow}▶${C.reset} ` : '  ';
      const tag = isCur ? `${C.cur}●${C.reset} ` : '  ';
      const text = i === cursor ? `${C.active} ${r} ${C.reset}` : r;
      out.write(`  ${marker}${tag}${text}\n`);
    });
  }
  out.write('\n');
  out.write(`  ${C.dim}↑↓  ·  Enter 선택  ·  q / Esc 취소${C.reset}\n`);
}

function ensureDir(): void {
  if (!existsSync(dirname(OUT_FILE))) mkdirSync(dirname(OUT_FILE), { recursive: true });
}

function commit(ref: string): never {
  ensureDir();
  try { writeFileSync(OUT_FILE, ref, 'utf8'); } catch {}
  process.exit(0);
}

function cancel(): never {
  try { unlinkSync(OUT_FILE); } catch {}
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
