import { execFileSync } from 'node:child_process';

// core.quotepath=false: keep UTF-8 paths raw so 한글 폴더가 octal escape로 새지 않는다.
const GIT_PREFIX = ['-c', 'core.quotepath=false'];

export function gitQuiet(cwd: string, args: string[], timeoutMs = 30_000): void {
  execFileSync('git', [...GIT_PREFIX, ...args], {
    cwd, stdio: ['ignore', 'ignore', 'pipe'], timeout: timeoutMs,
  });
}

export function gitOut(cwd: string, args: string[], timeoutMs = 8_000): string {
  return execFileSync('git', [...GIT_PREFIX, ...args], {
    cwd, stdio: ['ignore', 'pipe', 'pipe'], timeout: timeoutMs,
  }).toString();
}

export function gitOutBuf(cwd: string, args: string[], timeoutMs = 8_000): Buffer {
  return execFileSync('git', [...GIT_PREFIX, ...args], {
    cwd, stdio: ['ignore', 'pipe', 'pipe'], timeout: timeoutMs,
    maxBuffer: 10 * 1024 * 1024,
  });
}
