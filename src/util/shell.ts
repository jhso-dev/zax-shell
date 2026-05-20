import { execFileSync } from 'node:child_process';

/** Quote a single shell argument for use inside `bash -lc '...'` etc. */
export function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/** Return true iff `bin` is on $PATH. */
export function hasBin(bin: string): boolean {
  try {
    execFileSync('which', [bin], { stdio: ['ignore', 'ignore', 'ignore'] });
    return true;
  } catch { return false; }
}
