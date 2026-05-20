import { execFileSync } from 'node:child_process';

export interface DepCheck {
  name: string;
  required: boolean;
  installed: boolean;
  version?: string;
  install: InstallStep[];
  doc?: string;
  /** Whether the tool needs a post-install login (`acli auth login`, ...). */
  needsAuth?: boolean;
  blurb?: string;
}

export type InstallStep =
  | { kind: 'brew-tap'; name: string }
  | { kind: 'brew-install'; pkg: string };

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
