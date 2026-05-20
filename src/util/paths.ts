import { homedir } from 'node:os';
import { join } from 'node:path';

// When ZAX_SHELL_DEV=1 every persistent path (state, config, nvim, repo,
// worktrees) and the default tmux session name pivot to a parallel
// "-dev" namespace so a developer running the dev launcher can't clobber
// their installed copy's data.
export const IS_DEV = process.env.ZAX_SHELL_DEV === '1';
export const ZAX_HOME = join(homedir(), IS_DEV ? '.zax-shell-dev' : '.zax-shell');
export const DEFAULT_TMUX_SESSION = IS_DEV ? 'zax-dev' : 'zax';
