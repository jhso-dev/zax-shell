import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { NVIM_INIT_FILE } from './nvim-config.js';

const has = (bin: string): boolean => {
  try {
    execFileSync('which', [bin], { stdio: ['ignore', 'ignore', 'ignore'] });
    return true;
  } catch { return false; }
};

const shellQuote = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`;

export interface ViewerChoice {
  /** Shell command line (already quoted). */
  cmd: string;
  /** Short name for UI display, e.g. "glow", "less", "vim". */
  name: string;
  /** Human-readable close instruction. */
  closeKey: string;
}

/**
 * Pick the best available viewer for the given file.
 *
 * Preferred order for .md:
 *   1. glow -p           (TUI markdown renderer, pager mode, q to quit)
 *   2. bat --paging=always -l md   (syntax-highlighted pager, q to quit)
 *   3. $EDITOR <file>    (vim/nvim: :q  ·  nano: ^X)
 *   4. less <file>       (q to quit)
 *
 * For non-md, EDITOR takes precedence so users get their familiar editor;
 * if unset, less.
 */
/**
 * Pick the best editor. Preferred order:
 *   1. $EDITOR if user set one
 *   2. nvim
 *   3. vim
 *   4. nano
 */
export function pickEditor(absPath: string): ViewerChoice {
  const f = shellQuote(absPath);

  // If user set $EDITOR they made an explicit choice — respect it.
  if (process.env.EDITOR && has((process.env.EDITOR.split(' ')[0]!))) {
    const e = process.env.EDITOR;
    const closeKey =
      /vim|nvim/.test(e) ? ':q' :
      /nano/.test(e)     ? 'Ctrl-X' :
      /emacs/.test(e)    ? 'Ctrl-X Ctrl-C' :
                            'editor-specific';
    return { cmd: `${e} ${f}`, name: e.split('/').pop()!, closeKey };
  }

  // Default: nvim with zax-shell's bundled config (markview.nvim renders the
  // .md inline). Falls back to plain nvim if config is missing.
  if (has('nvim')) {
    if (existsSync(NVIM_INIT_FILE)) {
      return { cmd: `nvim -u ${shellQuote(NVIM_INIT_FILE)} ${f}`,
               name: 'nvim+markview', closeKey: ':q' };
    }
    return { cmd: `nvim ${f}`, name: 'nvim', closeKey: ':q' };
  }
  if (has('vim'))  return { cmd: `vim ${f}`,  name: 'vim',  closeKey: ':q' };
  return { cmd: `nano ${f}`, name: 'nano', closeKey: 'Ctrl-X' };
}

export function pickViewer(absPath: string): ViewerChoice {
  const isMd = /\.(md|markdown)$/i.test(absPath);
  const f = shellQuote(absPath);

  // Default for .md: nvim + markview.nvim. Single tool that renders AND
  // edits — press `i` to edit, `Esc` to render, `:w` to save, `:q` to close.
  if (isMd && has('nvim') && existsSync(NVIM_INIT_FILE)) {
    return {
      cmd: `nvim -u ${shellQuote(NVIM_INIT_FILE)} ${f}`,
      name: 'nvim+markview',
      closeKey: ':q',
    };
  }
  // Fallbacks (in order of niceness).
  if (isMd && has('glow')) {
    return { cmd: `glow -p ${f}`, name: 'glow', closeKey: 'q' };
  }
  if (process.env.EDITOR && has(process.env.EDITOR.split(' ')[0]!)) {
    const e = process.env.EDITOR;
    const closeKey =
      /vim|nvim/.test(e) ? ':q' :
      /nano/.test(e)     ? 'Ctrl-X' :
      /emacs/.test(e)    ? 'Ctrl-X Ctrl-C' :
                            'editor-specific';
    return { cmd: `${e} ${f}`, name: e.split('/').pop()!, closeKey };
  }
  if (has('nvim'))  return { cmd: `nvim ${f}`, name: 'nvim', closeKey: ':q' };
  return { cmd: `less -R ${f}`, name: 'less', closeKey: 'q' };
}
