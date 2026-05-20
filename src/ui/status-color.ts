/**
 * Map a Jira status name (Korean or English) to an Ink color name.
 * Falls back to undefined (default terminal color) for unknown statuses.
 */
const NORMALIZED: Record<string, string> = {
  // In progress
  'in progress':      'yellow',
  'inprogress':       'yellow',
  '진행중':            'yellow',
  '진행 중':           'yellow',

  // To do / waiting
  'to do':            'gray',
  'todo':             'gray',
  'open':             'gray',
  'backlog':          'gray',
  '대기':              'gray',
  '시작 전':           'gray',
  '백로그':            'gray',

  // Review / blocked
  'in review':        'magenta',
  'review':           'magenta',
  'blocked':          'red',
  '리뷰':              'magenta',
  '리뷰중':            'magenta',

  // Ready for deploy
  'ready for deploy': 'cyan',
  'ready deploy':     'cyan',
  'staging':          'cyan',

  // Done
  'done':             'greenBright',
  'closed':           'greenBright',
  'resolved':         'greenBright',
  '완료':              'greenBright',
};

export function statusColor(status: string | undefined): string | undefined {
  if (!status) return undefined;
  return NORMALIZED[status.trim().toLowerCase()];
}

/** Short badge text — keep it terse for narrow panels. */
export function statusBadge(status: string | undefined, max = 12): string {
  if (!status) return '';
  const s = status.trim();
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}
