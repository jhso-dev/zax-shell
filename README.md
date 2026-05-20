# zax-shell

ZAX 워크플로우용 콕핏 TUI — Jira 에픽, product-hub 산출물, Claude Code 세션을 한 터미널 화면에서.

```
┌────────── Dashboard: B2C-50055 · drift=1 stale=0 · jira=ok ──────────┐
├─ Epics ──────────────────────┬─ Claude Code ────────────────────────┤
│ ▸ B2C-50055  In Progress     │ $ /workflow spec                     │
│   B2C-50211  To Do           │ > 작성 중...                         │
│   HGNN-13115 In Progress     │                                      │
├─ Product-Hub ────────────────┤                                      │
│ ✓ P docs/prd/prd.md          │                                      │
│ ◐ A artifacts/architecture.. │                                      │
│ H docs/wireframe.html        │                                      │
└──────────────────────────────┴──────────────────────────────────────┘
```

## 설치

macOS, Homebrew 필요. 다음을 순서대로:

```bash
# 1) 설치 스크립트 다운로드
curl -fsSLo /tmp/zax-shell-install.sh https://raw.githubusercontent.com/jhso-dev/zax-shell/main/install.sh

# 2) (선택) 내용 확인
less /tmp/zax-shell-install.sh

# 3) 실행
bash /tmp/zax-shell-install.sh
```

또는 직접 clone 후 설치:

```bash
git clone https://github.com/jhso-dev/zax-shell.git ~/.zax-shell
cd ~/.zax-shell && npm ci && npm run build
ln -sf ~/.zax-shell/bin/zax-shell /usr/local/bin/zax-shell
```

첫 실행 시 zax-shell이 필요한 도구(tmux, acli, gh, jira-cli, gh-dash, nvim+markview)를 자동으로 brew/gh-extension으로 설치하고 OAuth/토큰 가이드까지 끌어줍니다.

```bash
zax-shell
```

## 핵심 단축키

### Epics 패널
| 키 | 동작 |
|---|---|
| `↑↓` / `j` `k` | 커서 이동 |
| `Enter` | 에픽 선택 → 우측 Claude 자동 실행 |
| `/` | 로컬 키워드 필터 |
| `s` | **Jira 전체 검색** (참여 안 한 에픽까지) |
| `S` | 정렬 순환 (updated → key → status) |
| `p` | 프로젝트 prefix 순환 |
| `d` | Jira 에픽 상세 popup (jira-cli) |
| `g` | GitHub PR/Issue popup (gh-dash) |
| `o` | 브라우저에서 Jira 에픽 열기 |
| `Esc` | 검색/필터 해제 |
| `?` | 도움말 popup |
| `q` | 종료 확인 popup |

### Product-Hub 패널
| 키 | 동작 |
|---|---|
| `Enter` | 산출물 열기 (`.md` → nvim+markview, `.html` → 기본 브라우저) |
| `r` | **갱신** (Jira 재조회 + product-hub fetch + main worktree 재핀) |
| `g` | 이 에픽의 GitHub popup |
| `o` | 브라우저에서 Jira 열기 |

### 패널 이동 (tmux)
| 키 | 동작 |
|---|---|
| `Tab` | Epics ↔ Product-Hub ↔ Claude (Claude 안에선 pass-through) |
| `Ctrl-T` | Claude에서 키보드로 빠져나오기 |
| `Alt-,` `Alt-.` | 좌측 컬럼 너비 ←/→ |
| `Alt--` `Alt-=` | Epics 높이 ↑/↓ |

## 동작 원리

```
zax-shell (CLI)
 ├─ daemon (Node)              ← Jira 조회 + product-hub git + 상태 집계
 │   ├─ ~/.cache/zax-shell/state.json
 │   └─ ~/.cache/zax-shell/worktrees/
 │       ├─ _main/             ← origin/master 공유 worktree (drift 비교 anchor)
 │       └─ {EPIC-KEY}/        ← feat 브랜치별 worktree
 └─ tmux session "zax"
     ├─ pane: dashboard
     ├─ pane: epics
     ├─ pane: product-hub (artifacts)
     └─ pane: claude  (선택된 에픽 폴더에서 실행)
```

- **Main worktree (`_main/`)**: 사용자가 어느 브랜치에 체크아웃되어 있든 zax-shell은 항상 `origin/master` 기준으로 폴더/drift를 계산. 사용자 워킹 트리는 절대 안 건드림.
- **Feat 브랜치 worktree**: zax 워크플로우의 `feat/{KEY}/{stage}` 브랜치를 자동 탐지 → 해당 브랜치를 별도 worktree로 체크아웃 → claude/Artifacts 모두 거기서 작업.
- **IPC**: `state.json` (atomic write, daemon writes / panes read) + `events.jsonl` (panes append / daemon tails). 폴링 없음 — `r` 수동 갱신.

## 통합

| 도구 | 역할 | 자동 설치 |
|---|---|---|
| **tmux** | 4-pane 멀티플렉서 | ✓ |
| **acli** | Jira 에픽 조회 (workitem search) | ✓ (OAuth) |
| **gh** | product-hub git, gh-dash | ✓ (OAuth) |
| **jira-cli** | `d` 키 — 에픽 상세/코멘트/transition | ✓ (Atlassian API token) |
| **gh-dash** | `g` 키 — PR/Issue 대시보드 | ✓ |
| **nvim + markview** | Enter — .md 렌더+편집 한 화면 | ✓ |

## 자주 묻는 것

**Q. product-hub working tree가 dirty/다른 브랜치인데 zax-shell이 동작하나요?**
네. zax-shell은 `_main` worktree(별도 detached 체크아웃)를 사용해서 사용자 워킹 트리에 무관하게 동작합니다.

**Q. 머지 안 된 에픽도 보고 싶어요.**
`s`로 Jira 전체 검색 → 선택. `origin/feat/{KEY}/spec`(또는 architecture/prd)을 자동 탐지해서 별도 worktree로 체크아웃하고 산출물 표시.

**Q. claude 세션이 매번 새로 뜨나요?**
같은 에픽 재선택은 no-op. 다른 에픽으로 이동 후 돌아오면 `claude --continue` 로 이전 대화 그대로 이어집니다 (cwd별 자동 분리).

**Q. jira-cli 인증이 안 돼요.**
첫 실행 시 안내가 나오지만 스킵했다면:
```bash
# Atlassian API 토큰 발급: https://id.atlassian.com/manage-profile/security/api-tokens
JIRA_API_TOKEN=<token> jira init
```

## CLI

```bash
zax-shell                      # 콕핏 시작 (또는 attach)
zax-shell --status             # tmux/daemon/health 확인
zax-shell --kill               # tmux 세션 + daemon 종료
zax-shell --jira-debug         # acli 진단
zax-shell --set productHubPath=/path/to/product-hub
zax-shell --config             # config 파일 경로
zax-shell --version
```

## 설정

`~/.config/zax-shell/config.json`:

```json
{
  "productHubPath": "/Users/me/dev/product-hub",
  "jql": "issuetype = 에픽 AND (assignee = currentUser() OR reporter = currentUser() OR watcher = currentUser()) AND statusCategory != Done ORDER BY updated DESC",
  "tmuxSession": "zax",
  "claudeBin": "claude"
}
```

Jira 한국어 인스턴스는 `issuetype = 에픽`, 영문은 `Epic`.

## 업그레이드

설치할 때와 동일한 명령을 다시 실행하면 최신으로 갱신됩니다 (install.sh가 idempotent).

```bash
cd ~/.zax-shell && git pull && npm ci && npm run build
```

## 트러블슈팅

- **상태 / 데몬 확인**: `zax-shell --status`
- **acli 진단**: `zax-shell --jira-debug`
- **모두 초기화**: `zax-shell --kill && rm -rf ~/.cache/zax-shell`
- **로그**: daemon stderr는 tmux 세션 종료 시 한 줄만 (`[zax-daemon] shutdown (reason)`)

## 라이센스

MIT
