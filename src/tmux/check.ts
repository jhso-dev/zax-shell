import { execFileSync } from 'node:child_process';

export interface TmuxStatus {
  installed: boolean;
  version?: string;
  insideTmux: boolean;
}

export function checkTmux(): TmuxStatus {
  const insideTmux = !!process.env.TMUX;
  try {
    const out = execFileSync('tmux', ['-V'], { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString().trim();
    return { installed: true, version: out, insideTmux };
  } catch {
    return { installed: false, insideTmux };
  }
}
