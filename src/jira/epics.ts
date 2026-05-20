import type { Epic } from '../ipc/state.js';
import type { Config } from '../config/index.js';
import { getCliEpics } from './cli.js';

const HARDCODED: Epic[] = [
  { key: 'B2C-50055',  summary: '직방 Hero copy 수정', status: 'In Progress' },
  { key: 'B2C-50211',  summary: '지킴진단 트윈스',     status: 'In Progress' },
  { key: 'HGNN-13558', summary: '약관 업데이트 자동화', status: 'To Do' },
  { key: 'TEST-260428', summary: 'AI 중개사',          status: 'In Progress' },
];

export async function fetchEpics(cfg: Config): Promise<Epic[]> {
  if (process.env.ZAX_SHELL_FAKE_JIRA === '1') return HARDCODED;
  return await getCliEpics(cfg.jql);
}
