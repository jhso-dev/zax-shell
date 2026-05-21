/**
 * zax-shell help popup script. Launched by `tmux display-popup` from the
 * daemon when the user presses ?. Renders a centered modal with all
 * keybindings; waits for q / Esc / ? to close.
 */

interface Row { keys: string; label: string }
interface Section { title: string; rows: Row[] }

const SECTIONS: Section[] = [
  {
    title: '에픽 리스트',
    rows: [
      { keys: '↑↓ / j k',     label: '커서 이동' },
      { keys: 'PgUp / PgDn',  label: '한 페이지 이동' },
      { keys: 'G',            label: '맨 아래' },
      { keys: 'Enter',        label: '에픽 선택 → 우측에 claude 실행' },
      { keys: '/',            label: '로컬 키워드 필터 (현재 리스트 안에서)' },
      { keys: 's',            label: 'Jira 전체 검색 — 내가 참여 안 한 에픽까지 (Esc 해제)' },
      { keys: 'o',            label: '브라우저에서 Jira 에픽 열기' },
      { keys: 'Esc',          label: '필터 / 팔레트 해제' },
    ],
  },
  {
    title: '시스템 (모두 수동, 자동 폴링 없음)',
    rows: [
      { keys: 'r',            label: '갱신 — Epics pane: Jira만 / Product-Hub pane: git fetch만 / Dashboard: 둘 다' },
      { keys: 'p',            label: '프로젝트별 좁히기 — B2C → HGNN → 전체 순환' },
      { keys: 'S',            label: '정렬 순환 (updated → key → status)' },
      { keys: ':',            label: '명령 팔레트' },
      { keys: '?',            label: '이 도움말' },
      { keys: 'q',            label: '종료 확인 팝업' },
    ],
  },
  {
    title: 'pane 이동 / 종료',
    rows: [
      { keys: 'Ctrl-T',       label: 'pane 순환 (Epics → Hub → Claude → ...)' },
      { keys: '마우스 클릭',  label: '클릭한 pane으로 포커스' },
      { keys: 'Ctrl-C',       label: 'cockpit 전체 종료 (어느 pane에서 눌러도)' },
    ],
  },
  {
    title: 'pane 크기 조절',
    rows: [
      { keys: '마우스 드래그', label: 'pane 경계선 드래그' },
    ],
  },
  {
    title: 'Product-Hub 패널',
    rows: [
      { keys: 'Enter',        label: '커서 파일을 nvim 으로 열기' },
      { keys: 'b',            label: '브랜치 전환 popup' },
      { keys: 'o',            label: '커서 파일을 GitHub blob 페이지로 열기' },
    ],
  },
];

const C = {
  reset:  '\x1b[0m',
  title:  '\x1b[1;36m',
  hdr:    '\x1b[1;33m',
  key:    '\x1b[36m',
  dim:    '\x1b[2m',
};

const out = process.stdout;
const inp = process.stdin;

inp.setRawMode(true);
inp.resume();
out.write('\x1b[?25l');                 // hide cursor
const restore = () => out.write('\x1b[?25h');
process.on('exit', restore);

out.write('\n');
out.write(`   ${C.title}ZAX SHELL — 키바인딩${C.reset}\n`);
for (const sec of SECTIONS) {
  out.write('\n');
  out.write(`   ${C.hdr}· ${sec.title}${C.reset}\n`);
  for (const r of sec.rows) {
    out.write(`     ${C.key}${r.keys.padEnd(18)}${C.reset}  ${r.label}\n`);
  }
}
out.write('\n');
out.write(`   ${C.dim}닫기:  q  /  Esc  /  ?${C.reset}\n`);

inp.on('data', (d) => {
  const ch = d.toString();
  if (ch === 'q' || ch === 'Q' || ch === '\x1b' || ch === '?' ||
      ch === '\r' || ch === '\n' || ch === '\x03') {
    process.exit(0);
  }
});
