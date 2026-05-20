import { spawn, execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import readline from 'node:readline';
import type { DepCheck, InstallStep } from './preflight.js';
import { ensureNvimConfig, bootstrapNvimPlugins } from './nvim-config.js';
import { saveJiraToken, loadJiraToken } from './jira-token.js';

const has = (bin: string): boolean => {
  try {
    execFileSync('which', [bin], { stdio: ['ignore', 'ignore', 'ignore'] });
    return true;
  } catch { return false; }
};

const ask = (q: string, defaultYes = true): Promise<boolean> => {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const suffix = defaultYes ? '[Y/n]' : '[y/N]';
    rl.question(`${q} ${suffix} `, (ans) => {
      rl.close();
      const t = ans.trim();
      if (!t) return resolve(defaultYes);
      resolve(/^y/i.test(t));
    });
  });
};

const run = (cmd: string, args: string[], extraEnv?: NodeJS.ProcessEnv): Promise<void> =>
  new Promise((resolve, reject) => {
    const env = extraEnv ? { ...process.env, ...extraEnv } : process.env;
    const child = spawn(cmd, args, { stdio: 'inherit', env });
    child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`${cmd} ${args.join(' ')} failed (exit ${code})`)));
    child.on('error', reject);
  });

// One-shot prompt; echo stays on (secret entry but easier to verify pastes).
const askLine = (q: string): Promise<string> => {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(q, (ans) => {
      rl.close();
      resolve(ans.trim());
    });
  });
};

const runStep = async (step: InstallStep): Promise<void> => {
  if (step.kind === 'brew-tap') {
    await run('brew', ['tap', step.name]);
  } else if (step.kind === 'brew-install') {
    await run('brew', ['install', step.pkg]);
  } else if (step.kind === 'gh-extension') {
    await run('gh', ['extension', 'install', step.repo]);
  }
};

const jiraConfigFileExists = (): boolean => {
  const home = process.env.HOME ?? '';
  return [
    join(home, '.config', '.jira', '.config.yml'),
    join(home, '.config', 'jira', '.config.yml'),
    join(home, '.jira.d', 'config.yml'),
  ].some((p) => existsSync(p));
};

// Probe `jira me` instead of just checking the config file — aborted
// `jira init` runs leave partial configs behind.
const jiraCliConfigured = (): boolean => {
  if (!jiraConfigFileExists()) return false;
  const env = { ...process.env };
  if (!env.JIRA_API_TOKEN) {
    const saved = loadJiraToken();
    if (saved) env.JIRA_API_TOKEN = saved;
  }
  try {
    execFileSync('jira', ['me'], {
      stdio: ['ignore', 'ignore', 'ignore'],
      timeout: 5000,
      env,
    });
    return true;
  } catch {
    return false;
  }
};

export async function autoInstall(deps: DepCheck[]): Promise<{ ok: boolean; needsAuth: string[] }> {
  const needsAuth: string[] = [];

  // Catches "pre-installed jira-cli but `jira init` never run".
  const collectPreInstalledAuth = () => {
    if (has('jira') && !jiraCliConfigured() && !needsAuth.includes('jira')) {
      needsAuth.push('jira');
    }
  };

  const missing = deps.filter((d) => !d.installed);
  if (missing.length === 0) {
    collectPreInstalledAuth();
    return { ok: true, needsAuth };
  }

  if (!has('brew')) {
    console.error('');
    console.error('Homebrew가 필요합니다. 먼저 설치:');
    console.error('  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"');
    console.error('');
    return { ok: false, needsAuth: [] };
  }

  const required = missing.filter((d) => d.required);
  const optional = missing.filter((d) => !d.required);

  console.error('');
  console.error('zax-shell 의존성 점검:');
  for (const d of deps) {
    if (d.installed) {
      console.error(`  ✓ ${d.name.padEnd(8)} ${d.version ?? ''}`);
    } else {
      const tag = d.required ? '(필수 · 미설치)' : '(권장 · 미설치)';
      console.error(`  ✗ ${d.name.padEnd(8)} ${tag}  — ${d.blurb ?? ''}`);
    }
  }
  console.error('');

  let installedNvim = false;
  const proceed = await ask(
    `미설치 도구 ${missing.length}개(필수 ${required.length}, 권장 ${optional.length})를 Homebrew로 자동 설치할까요?`,
    true,
  );
  if (!proceed) return { ok: false, needsAuth: [] };

  for (const d of required) {
    console.error(`\n▶ ${d.name} 설치 중… (필수)`);
    try {
      for (const s of d.install) await runStep(s);
      console.error(`✓ ${d.name} 설치 완료`);
      if (d.needsAuth) needsAuth.push(d.name);
    } catch (err) {
      console.error(`✗ ${d.name} 설치 실패: ${(err as Error).message}`);
      return { ok: false, needsAuth };
    }
  }
  for (const d of optional) {
    console.error(`\n▶ ${d.name} 설치 중… (권장)`);
    try {
      for (const s of d.install) await runStep(s);
      console.error(`✓ ${d.name} 설치 완료`);
      if (d.name === 'nvim') installedNvim = true;
      if (d.needsAuth) needsAuth.push(d.name);
    } catch (err) {
      console.error(`✗ ${d.name} 설치 실패 (건너뜀): ${(err as Error).message}`);
    }
  }

  // Warm up markview.nvim so the first `e` press is instant, not a 60s lazy load.
  if (installedNvim || has('nvim')) {
    ensureNvimConfig();
    if (installedNvim) {
      console.error('\n▶ nvim 마크다운 플러그인(markview.nvim) 부트스트랩…');
      console.error('  처음 한 번만 ~30~60초 걸립니다.');
      await bootstrapNvimPlugins();
      console.error('✓ markview.nvim 준비 완료');
    }
  }

  collectPreInstalledAuth();

  return { ok: true, needsAuth };
}

export async function runAuth(tools: string[]): Promise<void> {
  for (const t of tools) {
    if (t === 'jira') {
      await runJiraInit();
      continue;
    }

    const loginCmd = t === 'acli' ? ['acli', 'auth', 'login']
                   : t === 'gh'   ? ['gh',   'auth', 'login']
                   : null;
    if (!loginCmd) continue;

    try {
      execFileSync(loginCmd[0]!, ['auth', 'status'], { stdio: 'ignore' });
      console.error(`✓ ${t} 이미 인증됨`);
      continue;
    } catch {}

    console.error('');
    const proceed = await ask(`${t} 로그인 실행할까요? (브라우저가 열립니다)`, true);
    if (!proceed) {
      console.error(`(나중에 \`${loginCmd.join(' ')}\` 를 직접 실행해 주세요)`);
      continue;
    }
    try {
      await run(loginCmd[0]!, loginCmd.slice(1));
    } catch (err) {
      console.error(`✗ ${t} 인증 실패: ${(err as Error).message}`);
    }
  }
}

async function runJiraInit(): Promise<void> {
  if (jiraCliConfigured()) {
    console.error('✓ jira-cli 이미 인증됨');
    return;
  }
  console.error('');
  console.error('jira-cli 인증 (d 키로 에픽 상세 보기에 필요)');
  console.error('  · 사이트:    https://zigbang.atlassian.net  (또는 본인 조직 도메인)');
  console.error('  · 인증:      Atlassian API 토큰 + 이메일');
  console.error('  · 토큰 발급: https://id.atlassian.com/manage-profile/security/api-tokens');
  console.error('');

  const proceed = await ask('지금 jira-cli 인증을 진행할까요? (스킵해도 zax-shell 자체는 동작)', true);
  if (!proceed) {
    console.error('(나중에 `JIRA_API_TOKEN=... jira init` 으로 직접 실행해 주세요)');
    return;
  }

  try {
    spawn('open', ['https://id.atlassian.com/manage-profile/security/api-tokens'],
      { detached: true, stdio: 'ignore' }).unref();
    console.error('▶ 브라우저에서 토큰 페이지를 열었습니다.');
    console.error('  "Create API token" → 라벨 입력 → 토큰 복사 → 아래에 붙여넣기.');
    console.error('');
  } catch {}

  // jira-cli `init` reads the token from JIRA_API_TOKEN env, not stdin.
  let token = process.env.JIRA_API_TOKEN ?? '';
  if (!token) {
    token = await askLine('Atlassian API token (붙여넣고 Enter): ');
    if (!token) {
      console.error('(토큰이 비어 있어 중단합니다. 나중에 다시 시도하세요.)');
      return;
    }
  }

  try {
    await run('jira', ['init'], { JIRA_API_TOKEN: token });
    saveJiraToken(token);
    process.env.JIRA_API_TOKEN = token;
    console.error('');
    console.error('✓ jira-cli 인증 완료 (토큰은 ~/.config/zax-shell/jira-token 에 저장)');
  } catch (err) {
    console.error(`✗ jira-cli 인증 실패: ${(err as Error).message}`);
    console.error('  토큰 / 이메일 / 사이트가 맞는지 확인 후 다시 시도하세요:');
    console.error('  $ JIRA_API_TOKEN=<token> jira init');
  }
}
