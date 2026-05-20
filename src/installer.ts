import { spawn, execFileSync } from 'node:child_process';
import readline from 'node:readline';
import type { DepCheck, InstallStep } from './preflight.js';
import { ensureNvimConfig, bootstrapNvimPlugins } from './nvim-config.js';
import { hasBin as has } from './util/shell.js';

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

const run = (cmd: string, args: string[]): Promise<void> =>
  new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: 'inherit' });
    child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`${cmd} ${args.join(' ')} failed (exit ${code})`)));
    child.on('error', reject);
  });

const runStep = async (step: InstallStep): Promise<void> => {
  if (step.kind === 'brew-tap') {
    await run('brew', ['tap', step.name]);
  } else if (step.kind === 'brew-install') {
    await run('brew', ['install', step.pkg]);
  }
};

export async function autoInstall(deps: DepCheck[]): Promise<{ ok: boolean; needsAuth: string[] }> {
  const needsAuth: string[] = [];
  const missing = deps.filter((d) => !d.installed);
  if (missing.length === 0) return { ok: true, needsAuth };

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

  return { ok: true, needsAuth };
}

export async function runAuth(tools: string[]): Promise<void> {
  for (const t of tools) {
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
