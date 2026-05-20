import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';

export interface JiraCliCfg {
  /** Path to the acli binary (default: 'acli'). */
  bin?: string;
  /** Newer acli uses "workitem"; older uses "issue". Default: 'workitem'. */
  resource?: 'workitem' | 'issue';
  /** Per-call timeout in ms. */
  timeoutMs?: number;
}

export interface Config {
  productHubPath: string;
  /** JQL to fetch the user's epics. */
  jql: string;
  /** tmux session name. */
  tmuxSession: string;
  /** Path to the claude CLI binary. */
  claudeBin: string;
  /** acli (Atlassian CLI) settings. */
  jiraCli?: JiraCliCfg;
}

const CONFIG_DIR = process.env.ZAX_SHELL_CONFIG_DIR
  ?? join(homedir(), '.config', 'zax-shell');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');

// zax-shell maintains its own product-hub clone under ~/.cache so the user's
// working tree (wherever they keep it) is never touched. Overridable in
// config.json or via `zax-shell --set productHubPath=<path>`.
const DEFAULT_PRODUCT_HUB = process.env.ZAX_SHELL_STATE_DIR
  ? join(process.env.ZAX_SHELL_STATE_DIR, 'repo')
  : join(homedir(), '.cache', 'zax-shell', 'repo');

const DEFAULTS: Config = {
  productHubPath: DEFAULT_PRODUCT_HUB,
  // zigbang Jira uses Korean issue type names ("에픽"). Tenants with English
  // names should set `jql` in config to use "Epic" instead.
  jql: 'issuetype = 에픽 AND (assignee = currentUser() OR reporter = currentUser() OR watcher = currentUser()) AND statusCategory != Done ORDER BY updated DESC',
  tmuxSession: 'zax',
  claudeBin: 'claude',
};

export function loadConfig(): Config {
  if (!existsSync(CONFIG_FILE)) return { ...DEFAULTS };
  try {
    const raw = JSON.parse(readFileSync(CONFIG_FILE, 'utf8'));
    return { ...DEFAULTS, ...raw };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveConfig(cfg: Partial<Config>): Config {
  if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true });
  const merged = { ...loadConfig(), ...cfg };
  writeFileSync(CONFIG_FILE, JSON.stringify(merged, null, 2), 'utf8');
  return merged;
}

export { CONFIG_FILE, CONFIG_DIR };
