import { execFileSync } from 'node:child_process';

export interface DepCheck {
  name: string;
  required: boolean;
  installed: boolean;
  version?: string;
  /** Steps the auto-installer should run. */
  install: InstallStep[];
  /** Optional doc URL. */
  doc?: string;
  /** True if this CLI requires browser-based login after install. */
  needsAuth?: boolean;
  /** Short description shown to the user before installing. */
  blurb?: string;
}

export type InstallStep =
  | { kind: 'brew-tap'; name: string }
  | { kind: 'brew-install'; pkg: string }
  | { kind: 'gh-extension'; repo: string };

const probe = (cmd: string, args: string[]): { installed: boolean; version?: string } => {
  try {
    const out = execFileSync(cmd, args, {
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 4000,
    }).toString().trim().split('\n')[0]!.trim();
    return { installed: true, version: out };
  } catch {
    return { installed: false };
  }
};

const probeGhExtension = (slug: string): { installed: boolean; version?: string } => {
  try {
    const out = execFileSync('gh', ['extension', 'list'], {
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 4000,
    }).toString();
    if (new RegExp(`\\b${slug.replace('/', '\\/')}\\b`).test(out)) {
      return { installed: true, version: 'installed' };
    }
    return { installed: false };
  } catch {
    return { installed: false };
  }
};

export function checkDeps(): DepCheck[] {
  return [
    {
      name: 'tmux',
      required: true,
      blurb: '4-pane cockpit 화면 multiplexer',
      ...probe('tmux', ['-V']),
      install: [{ kind: 'brew-install', pkg: 'tmux' }],
    },
    {
      name: 'acli',
      required: true,
      blurb: 'Atlassian CLI — Jira 에픽 조회',
      needsAuth: true,
      ...probe('acli', ['--version']),
      install: [
        { kind: 'brew-tap', name: 'atlassian/homebrew-acli' },
        { kind: 'brew-install', pkg: 'acli' },
      ],
      doc: 'https://developer.atlassian.com/cloud/acli/guides/install-macos/',
    },
    {
      name: 'gh',
      required: true,
      blurb: 'GitHub CLI — product-hub 클론/동기화',
      needsAuth: true,
      ...probe('gh', ['--version']),
      install: [{ kind: 'brew-install', pkg: 'gh' }],
      doc: 'https://cli.github.com/',
    },
    {
      name: 'jira',
      required: false,
      blurb: 'jira-cli — 에픽 상세/코멘트/전이 (d 키)',
      needsAuth: true,
      ...probe('jira', ['version']),
      install: [
        { kind: 'brew-tap', name: 'ankitpokhrel/jira-cli' },
        { kind: 'brew-install', pkg: 'jira-cli' },
      ],
      doc: 'https://github.com/ankitpokhrel/jira-cli',
    },
    {
      name: 'gh-dash',
      required: false,
      blurb: 'gh-dash 확장 — PR/Issue TUI 대시보드 (g 키)',
      ...probeGhExtension('dlvhdr/gh-dash'),
      install: [{ kind: 'gh-extension', repo: 'dlvhdr/gh-dash' }],
      doc: 'https://github.com/dlvhdr/gh-dash',
    },
    {
      name: 'nvim',
      required: true,
      blurb: 'Neovim + markview.nvim — Artifacts Enter 시 마크다운을 렌더+편집',
      ...probe('nvim', ['--version']),
      install: [{ kind: 'brew-install', pkg: 'neovim' }],
    },
    {
      name: 'glow',
      required: false,
      blurb: 'TUI 마크다운 뷰어 (선택) — nvim 없을 때 fallback',
      ...probe('glow', ['--version']),
      install: [{ kind: 'brew-install', pkg: 'glow' }],
    },
  ];
}
