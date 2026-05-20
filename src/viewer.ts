import { existsSync } from 'node:fs';
import { NVIM_INIT_FILE } from './nvim-config.js';
import { hasBin as has, shellQuote } from './util/shell.js';

export interface ViewerChoice {
  cmd: string;
  name: string;
  closeKey: string;
}

export function pickViewer(absPath: string): ViewerChoice {
  const isMd = /\.(md|markdown)$/i.test(absPath);
  const f = shellQuote(absPath);

  if (isMd && has('nvim') && existsSync(NVIM_INIT_FILE)) {
    return {
      cmd: `nvim -u ${shellQuote(NVIM_INIT_FILE)} ${f}`,
      name: 'nvim+markview',
      closeKey: ':q',
    };
  }
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
