import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Epic } from '../ipc/state.js';
import { loadConfig } from '../config/index.js';

const execFileP = promisify(execFile);

interface AcliCfg {
  /** Path to the acli binary (default: 'acli' from PATH). */
  bin: string;
  /** Subcommand stem. Newer acli uses "workitem", older uses "issue". */
  resource: 'workitem' | 'issue';
  /** Per-call timeout in ms. */
  timeoutMs: number;
}

const getCfg = (): AcliCfg => {
  const c: any = loadConfig();
  const m = c.jiraCli ?? {};
  return {
    bin: m.bin ?? 'acli',
    resource: m.resource ?? 'workitem',
    timeoutMs: m.timeoutMs ?? 15_000,
  };
};

const exec = async (bin: string, args: string[], timeoutMs: number): Promise<string> => {
  try {
    const { stdout } = await execFileP(bin, args, {
      timeout: timeoutMs,
      maxBuffer: 16 * 1024 * 1024,
    });
    return stdout.toString();
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stderr?: Buffer | string };
    if (e.code === 'ENOENT') {
      throw new Error(
        `acli not found. Install:  brew install --cask acli  (or set jiraCli.bin in config)`,
      );
    }
    const stderr = e.stderr ? e.stderr.toString() : '';
    const tail = stderr.trim().split('\n').slice(-3).join(' | ');
    const hint = inferHint(stderr, e.message);
    throw new Error(
      `acli failed: ${tail || e.message}` + (hint ? ` — ${hint}` : ''),
    );
  }
};

const inferHint = (stderr: string, msg: string): string => {
  const j = (stderr + ' ' + msg).toLowerCase();
  if (j.includes('unauthorized') || j.includes('401') || j.includes('not logged in') || j.includes('please login') || j.includes('authentication')) {
    return 'Run `acli auth login` first';
  }
  if (j.includes('unknown command') || j.includes('unknown flag') || j.includes('unrecognized')) {
    return 'Your acli version may use a different command shape. Try setting jiraCli.resource = "issue" in config';
  }
  if (j.includes('jql') && j.includes('parse')) {
    return 'JQL syntax error — check the `jql` config value';
  }
  return '';
};

/**
 * Best-effort parser. acli's JSON output shape has varied across versions:
 *   - array of issues at root
 *   - { issues: [...] }
 *   - { data: { issues: [...] } }
 * Each issue may have either flat fields (key, summary, status) or nested
 * Jira REST shape ({ key, fields: { summary, status: { name } } }).
 */
const parseEpics = (text: string): Epic[] => {
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { return []; }

  let arr: any[] | null = null;
  if (Array.isArray(parsed)) arr = parsed;
  else if (Array.isArray((parsed as any)?.issues)) arr = (parsed as any).issues;
  else if (Array.isArray((parsed as any)?.data?.issues)) arr = (parsed as any).data.issues;
  else if (Array.isArray((parsed as any)?.results)) arr = (parsed as any).results;
  if (!arr) return [];

  return arr.map((it: any): Epic => {
    const key: string = it?.key ?? it?.id ?? '';
    const summary: string =
      it?.summary ?? it?.fields?.summary ?? it?.title ?? '';
    const status: string =
      it?.status ?? it?.fields?.status?.name ?? it?.statusName ?? '';
    return { key, summary, status, url: jiraBrowseUrl(key) };
  }).filter((e: Epic) => e.key.length > 0);
};

// acli only exposes REST API endpoints (`self`), never the human-facing
// /browse/ URL. Build it from the key + the Atlassian Cloud site host.
// Override via ZAX_SHELL_JIRA_SITE if your tenant isn't zigbang.
export function jiraBrowseUrl(key: string): string {
  if (!key) return '';
  const site = (process.env.ZAX_SHELL_JIRA_SITE ?? 'https://zigbang.atlassian.net')
    .replace(/\/$/, '');
  return `${site}/browse/${key}`;
}

export async function getCliEpics(jql: string): Promise<Epic[]> {
  const cfg = getCfg();
  const args = ['jira', cfg.resource, 'search', '--jql', jql, '--json'];
  const out = await exec(cfg.bin, args, cfg.timeoutMs);
  return parseEpics(out);
}

// Whitespace-collapse and drop any character that's not a safe alphanum,
// CJK letter, hyphen, underscore, period, or space. Without this, Lucene
// regex metachars (`* + ? . \ ^ $ { } ( ) | [ ]`) inside the `~` operator
// could trigger expensive regex evaluation server-side or just produce
// "unbalanced parens" parse errors. Whitelist > blacklist for safety.
function sanitizeQuery(raw: string): string {
  return raw
    .replace(/[^\p{L}\p{N}\-_. ]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function buildSearchJql(query: string): string {
  const q = sanitizeQuery(query);
  const keyMatch = /^([A-Z][A-Z0-9]+)-(\d+)$/.exec(q);
  // Direct key match is much faster than Lucene `text ~`.
  const where = keyMatch
    ? `(key = "${q}" OR text ~ "${q}")`
    : `(summary ~ "${q}" OR description ~ "${q}" OR text ~ "${q}")`;
  return `issuetype = 에픽 AND ${where} ORDER BY updated DESC`;
}

export async function searchCliEpics(query: string, limit = 50): Promise<Epic[]> {
  if (!sanitizeQuery(query)) return [];
  const cfg = getCfg();
  const jql = buildSearchJql(query);
  const args = ['jira', cfg.resource, 'search', '--jql', jql, '--json'];
  const out = await exec(cfg.bin, args, cfg.timeoutMs);
  const all = parseEpics(out);
  return all.slice(0, limit);
}

export interface JiraCliDebugReport {
  version: string;
  auth: { ok: boolean; message: string };
  sample: { ok: boolean; count?: number; error?: string };
}

/**
 * Diagnostic — runs each step independently and reports per-step result.
 * Never throws; surfaces what's wrong so the user can fix it.
 */
export async function jiraCliDebug(): Promise<JiraCliDebugReport> {
  const cfg = getCfg();
  const version = await exec(cfg.bin, ['--version'], 5_000)
    .then((s) => s.trim())
    .catch((e: Error) => `(${e.message})`);

  let auth: JiraCliDebugReport['auth'];
  try {
    const out = await exec(cfg.bin, ['auth', 'status'], 8_000);
    auth = { ok: true, message: out.trim() };
  } catch (err) {
    auth = { ok: false, message: (err as Error).message };
  }

  let sample: JiraCliDebugReport['sample'];
  if (!auth.ok) {
    sample = { ok: false, error: '(skipped — not authenticated)' };
  } else {
    try {
      const epics = await getCliEpics('issuetype = Epic ORDER BY updated DESC');
      sample = { ok: true, count: epics.length };
    } catch (err) {
      sample = { ok: false, error: (err as Error).message };
    }
  }

  return { version, auth, sample };
}
