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

macOS, Homebrew 필요.

```bash
curl -fsSLo /tmp/zax-shell-install.sh https://raw.githubusercontent.com/jhso-dev/zax-shell/main/install.sh && bash /tmp/zax-shell-install.sh
```

> 스크립트 내용을 먼저 보고 싶다면 `&& bash ...` 빼고 실행 후 `less /tmp/zax-shell-install.sh` 로 검토.

install.sh가 자동으로 처리하는 것:
- `~/.zax-shell` 에 clone + build
- `/usr/local/bin` (Intel) 또는 `~/.local/bin` (Apple Silicon · 기본) 에 symlink
- PATH 에 빠져 있으면 정확한 추가 명령을 출력

> Apple Silicon은 `/usr/local/bin` 이 기본적으로 없거나 권한이 없습니다. install.sh가 자동으로 `~/.local/bin` 으로 fallback하고 PATH 추가 명령을 안내합니다.

`bin` 디렉토리를 직접 지정하려면:
```bash
ZAX_SHELL_BIN_DIR=~/bin bash /tmp/zax-shell-install.sh
```

또는 직접 clone 후 설치:

```bash
git clone https://github.com/jhso-dev/zax-shell.git ~/.zax-shell
cd ~/.zax-shell && npm ci && npm run build
ln -sf ~/.zax-shell/bin/zax-shell ~/.local/bin/zax-shell    # ← Apple Silicon 권장
# 또는 ln -sf ~/.zax-shell/bin/zax-shell /usr/local/bin/zax-shell  (Intel)
```

첫 실행 시 zax-shell이 필요한 도구(tmux, acli, gh, nvim+markview)를 자동으로 brew로 설치하고 OAuth 인증까지 끌어줍니다.

```bash
zax-shell
```

## 핵심 단축키

### Epics 패널
| 키 | 동작 |
|---|---|
| `↑↓` / `j` `k` / `PgUp` `PgDn` / `G` | 커서 이동 |
| `Enter` | 에픽 선택 → 우측 Claude 자동 실행 |
| `/` | 로컬 키워드 필터 |
| `s` | **Jira 전체 검색** (참여 안 한 에픽까지). 빈 입력 + Enter 로 검색 해제 |
| `S` | 정렬 순환 (updated → key → status) |
| `p` | 프로젝트 prefix 순환 |
| `r` | Jira 에픽 다시 조회 |
| `o` | 브라우저에서 **Jira** 에픽 페이지 열기 |
| `Esc` | 검색/필터 해제 |

### Product-Hub 패널
| 키 | 동작 |
|---|---|
| `Enter` | 산출물 열기 — `.md` → nvim+markview **(view-only)**, `.html` → 기본 브라우저 |
| `b` | 브랜치 전환 popup (`origin/feat/{KEY}/*` 자동 탐지) |
| `r` | product-hub git fetch + main worktree 갱신 |
| `o` | 산출물 있으면 GitHub blob, 없으면 PR 검색 (org 전체) |

### 공통 (Dashboard / Epics / Product-Hub 패널 모두)
| 키 | 동작 |
|---|---|
| `?` | 도움말 popup |
| `q` | 종료 확인 popup |
| `Ctrl-T` | pane 순환 — Epics → Hub → Claude → Epics |
| `Ctrl-C` | **cockpit 전체 종료 (어느 pane에서 눌러도 즉시)** |
| 마우스 클릭 | 클릭한 pane으로 포커스 |
| 마우스 드래그 | pane 경계선 |

## 동작 원리

```
zax-shell (CLI)
 ├─ daemon (Node)              ← Jira 조회 + product-hub git + 상태 집계
 │   └─ ~/.zax-shell/state/
 │       ├─ state.json, events.jsonl, daemon.pid
 │       ├─ repo/              ← zax-shell 전용 product-hub 클론
 │       └─ worktrees/
 │           ├─ _main/         ← origin/master 공유 worktree (drift 비교 anchor)
 │           └─ {EPIC-KEY}/    ← feat 브랜치별 worktree
 └─ tmux session "zax"
     ├─ pane: dashboard
     ├─ pane: epics
     ├─ pane: product-hub (artifacts)
     └─ pane: claude  (선택된 에픽 폴더에서 실행)
```

모든 zax-shell 데이터는 `~/.zax-shell/` 한 곳에 모입니다:
- `~/.zax-shell/` (또는 사용자가 install.sh로 설치한 디렉토리) ← install (git/src/node_modules)
- `~/.zax-shell/state/` ← state.json, repo/, worktrees/, branch snapshots, daemon.pid
- `~/.zax-shell/config/` ← config.json, ui-prefs.json, nvim/
- uninstall: `rm -rf ~/.zax-shell` 한 줄

- **Main worktree (`_main/`)**: 사용자가 어느 브랜치에 체크아웃되어 있든 zax-shell은 항상 `origin/master` 기준으로 폴더/drift를 계산. 사용자 워킹 트리는 절대 안 건드림.
- **Feat 브랜치 worktree**: zax 워크플로우의 `feat/{KEY}/{stage}` 브랜치를 자동 탐지 → 해당 브랜치를 별도 worktree로 체크아웃 → claude/Artifacts 모두 거기서 작업.
- **IPC**: `state.json` (atomic write, daemon writes / panes read) + `events.jsonl` (panes append / daemon tails). 폴링 없음 — `r` 수동 갱신.

## 통합

| 도구 | 역할 | 자동 설치 |
|---|---|---|
| **tmux** | 4-pane 멀티플렉서 | ✓ |
| **acli** | Jira 에픽 조회 (workitem search) | ✓ (OAuth) |
| **gh** | product-hub git clone/fetch | ✓ (OAuth) |
| **nvim + markview** | Enter — `.md` 렌더 (view-only) | ✓ |

## 자주 묻는 것

**Q. product-hub를 따로 클론해야 하나요?**
아니요. zax-shell이 첫 실행 시 **자체 클론**을 `~/.zax-shell/state/repo` 에 자동으로 만듭니다. 사용자가 따로 갖고 있는 `~/dev/product-hub` 같은 워킹 트리는 zax-shell이 절대 안 건드립니다. 기존 클론을 재사용하고 싶으면 `zax-shell --set productHubPath=/path/to/your/product-hub`.

**Q. product-hub working tree가 dirty/다른 브랜치인데 zax-shell이 동작하나요?**
네. zax-shell은 `_main` worktree(별도 detached 체크아웃)를 사용해서 사용자 워킹 트리에 무관하게 동작합니다.

**Q. 머지 안 된 에픽도 보고 싶어요.**
`s`로 Jira 전체 검색 → 선택. `origin/feat/{KEY}/spec`(또는 architecture/prd)을 자동 탐지해서 별도 worktree로 체크아웃하고 산출물 표시.

**Q. claude 세션이 매번 새로 뜨나요?**
같은 에픽 재선택은 no-op. 다른 에픽으로 이동 후 돌아오면 `claude --continue` 로 이전 대화 그대로 이어집니다 (cwd별 자동 분리).

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

`~/.zax-shell/config/config.json`:

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

zax-shell 실행 시 매번 GitHub Release 의 latest 와 비교합니다. 새 버전이 있으면 prompt 표시 → `y` → 자동 갱신 + 재시작. 수동 갱신은 아래.

```bash
cd ~/.zax-shell && git pull && npm ci && npm run build
```

## 트러블슈팅

- **상태 / 데몬 확인**: `zax-shell --status`
- **acli 진단**: `zax-shell --jira-debug`
- **모두 초기화**: `zax-shell --kill && rm -rf ~/.zax-shell/state ~/.zax-shell/config`
- **로그**: daemon stderr는 tmux 세션 종료 시 한 줄만 (`[zax-daemon] shutdown (reason)`)

## 라이센스

MIT
