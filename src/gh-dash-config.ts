import { writeFileSync, renameSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { STATE_DIR } from './ipc/state.js';

const CONFIG_PATH = join(STATE_DIR, 'gh-dash.yml');
// zax workflow spans many repos (product-hub for docs, zigbang_korean /
// honggangnono / ... for actual code). All filters are org-scoped so the
// dashboard never gets capped by gh-dash's "default repo from cwd remote".
const ORG = process.env.ZAX_SHELL_GH_ORG ?? 'zigbang';

const yamlEscape = (s: string): string => s.replace(/"/g, '\\"');

export function writeGhDashConfig(epicKey: string): string {
  const key = yamlEscape(epicKey);
  const yaml = `prSections:
  - title: "${key} PR"
    filters: "org:${ORG} in:title,body ${key}"
  - title: "내 PR (org 전체, 열림)"
    filters: "org:${ORG} is:open author:@me"
  - title: "내 리뷰 대기 (org 전체)"
    filters: "org:${ORG} is:open review-requested:@me"

issuesSections:
  - title: "${key} Issue"
    filters: "org:${ORG} in:title,body ${key}"

defaults:
  preview:
    open: true
    width: 60
  prsLimit: 30
  issuesLimit: 30
  view: prs
  layout:
    prs:
      updatedAt:
        width: 7
      repo:
        width: 28
      title:
        grow: true
`;

  if (!existsSync(dirname(CONFIG_PATH))) mkdirSync(dirname(CONFIG_PATH), { recursive: true });
  const tmp = CONFIG_PATH + '.tmp';
  writeFileSync(tmp, yaml, 'utf8');
  renameSync(tmp, CONFIG_PATH);
  return CONFIG_PATH;
}
