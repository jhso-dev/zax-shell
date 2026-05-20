#!/usr/bin/env bash
# zax-shell installer
#
# Idempotent: re-running this script upgrades an existing install in place.
# What it does:
#   1. clones (or pulls) the repo into ~/.zax-shell
#   2. installs dependencies and builds the TypeScript sources
#   3. symlinks the launcher into a directory on $PATH (default /usr/local/bin)
#
# The first time you actually run `zax-shell`, it will prompt you to install
# brew packages (tmux, acli, gh, jira-cli, nvim) and walk you through OAuth /
# token setup. Nothing system-wide happens in this installer.

set -euo pipefail

REPO_URL="${ZAX_SHELL_REPO_URL:-https://github.com/jhso-dev/zax-shell.git}"
REPO_REF="${ZAX_SHELL_REF:-main}"
INSTALL_DIR="${ZAX_SHELL_DIR:-$HOME/.zax-shell}"
BIN_DIR="${ZAX_SHELL_BIN_DIR:-/usr/local/bin}"
LINK_PATH="$BIN_DIR/zax-shell"

info()  { printf '\033[1;36m▶\033[0m %s\n' "$*"; }
ok()    { printf '\033[1;32m✓\033[0m %s\n' "$*"; }
warn()  { printf '\033[1;33m⚠\033[0m %s\n' "$*" >&2; }
fail()  { printf '\033[1;31m✗\033[0m %s\n' "$*" >&2; exit 1; }

# ── prerequisites ────────────────────────────────────────────────────────
[ "$(uname -s)" = "Darwin" ] || fail "현재는 macOS만 지원합니다 (uname=$(uname -s))"
command -v git  >/dev/null || fail "git 이 필요합니다"
command -v node >/dev/null || fail "Node.js 20+ 가 필요합니다 (brew install node)"
NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
[ "$NODE_MAJOR" -ge 20 ] || fail "Node.js 20 이상이 필요합니다 (현재 $(node -v))"
command -v npm  >/dev/null || fail "npm 이 필요합니다"

# ── repo: clone or update ────────────────────────────────────────────────
if [ -d "$INSTALL_DIR/.git" ]; then
  info "기존 설치 발견 — 업데이트 ($INSTALL_DIR)"
  git -C "$INSTALL_DIR" fetch --quiet origin
  git -C "$INSTALL_DIR" checkout --quiet "$REPO_REF"
  git -C "$INSTALL_DIR" pull --ff-only --quiet origin "$REPO_REF"
else
  info "clone → $INSTALL_DIR"
  git clone --depth 1 --branch "$REPO_REF" "$REPO_URL" "$INSTALL_DIR"
fi
ok "소스 준비됨"

# ── build ────────────────────────────────────────────────────────────────
info "의존성 설치"
(cd "$INSTALL_DIR" && npm ci --silent)

info "TypeScript 빌드"
(cd "$INSTALL_DIR" && npm run build --silent)
ok "빌드 완료"

# ── symlink ──────────────────────────────────────────────────────────────
if [ ! -d "$BIN_DIR" ]; then
  mkdir -p "$BIN_DIR" 2>/dev/null || fail "$BIN_DIR 이 없거나 쓸 수 없습니다. ZAX_SHELL_BIN_DIR=<경로> 로 재실행하세요."
fi

if [ -w "$BIN_DIR" ]; then
  ln -sf "$INSTALL_DIR/bin/zax-shell" "$LINK_PATH"
else
  warn "$BIN_DIR 쓰기 권한 없음 — sudo 로 symlink"
  sudo ln -sf "$INSTALL_DIR/bin/zax-shell" "$LINK_PATH"
fi
ok "symlink: $LINK_PATH → $INSTALL_DIR/bin/zax-shell"

# ── done ─────────────────────────────────────────────────────────────────
echo
ok "설치 완료. 다음 명령으로 시작하세요:"
echo "    zax-shell"
echo
echo "첫 실행 시 brew 패키지(tmux, acli, gh, jira-cli, gh-dash, nvim)를 설치할지 묻고,"
echo "Atlassian / GitHub 인증까지 안내합니다."
