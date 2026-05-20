import { writeFileSync, readFileSync, existsSync, mkdirSync, chmodSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

const CONFIG_DIR = process.env.ZAX_SHELL_CONFIG_DIR
  ?? join(homedir(), '.zax-shell', 'config');
const TOKEN_FILE = join(CONFIG_DIR, 'jira-token');

// Persisted so children (daemon → jira-cli popups) inherit JIRA_API_TOKEN
// without the user editing their shell rc.

export function saveJiraToken(token: string): void {
  if (!existsSync(dirname(TOKEN_FILE))) {
    mkdirSync(dirname(TOKEN_FILE), { recursive: true });
  }
  writeFileSync(TOKEN_FILE, token, { encoding: 'utf8', mode: 0o600 });
  try { chmodSync(TOKEN_FILE, 0o600); } catch {}
}

export function loadJiraToken(): string | null {
  try {
    const v = readFileSync(TOKEN_FILE, 'utf8').trim();
    return v.length > 0 ? v : null;
  } catch { return null; }
}

export function injectJiraTokenEnv(): void {
  if (process.env.JIRA_API_TOKEN) return;
  const t = loadJiraToken();
  if (t) process.env.JIRA_API_TOKEN = t;
}
