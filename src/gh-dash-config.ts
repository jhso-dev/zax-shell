import { writeFileSync, renameSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { STATE_DIR } from './ipc/state.js';

const CONFIG_PATH = join(STATE_DIR, 'gh-dash.yml');

const yamlEscape = (s: string): string => s.replace(/"/g, '\\"');

export function writeGhDashConfig(epicKey: string): string {
  const key = yamlEscape(epicKey);
  const yaml = `prSections:
  - title: "${key} PR"
    filters: "in:title,body ${key}"
  - title: "내가 작성한 PR (열림)"
    filters: "is:open author:@me"
  - title: "내 리뷰 대기"
    filters: "is:open review-requested:@me"

issuesSections:
  - title: "${key} Issue"
    filters: "in:title,body ${key}"

defaults:
  preview:
    open: true
    width: 60
  prsLimit: 20
  issuesLimit: 20
  view: prs
  layout:
    prs:
      updatedAt:
        width: 7
      repo:
        width: 18
      title:
        grow: true
`;

  if (!existsSync(dirname(CONFIG_PATH))) mkdirSync(dirname(CONFIG_PATH), { recursive: true });
  const tmp = CONFIG_PATH + '.tmp';
  writeFileSync(tmp, yaml, 'utf8');
  renameSync(tmp, CONFIG_PATH);
  return CONFIG_PATH;
}
