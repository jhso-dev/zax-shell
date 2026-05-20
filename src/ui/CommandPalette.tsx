import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { execFileSync, spawn } from 'node:child_process';
import { emitEvent } from '../ipc/store.js';
import { loadConfig, CONFIG_FILE } from '../config/index.js';

interface Command {
  id: string;
  label: string;
  run: () => void;
}

const openInEditor = (absPath: string) => {
  emitEvent({ type: 'open-file', absPath });
};

const baseCommands = (): Command[] => {
  const cfg = loadConfig();
  return [
    { id: 'refresh',        label: 'refresh — Jira/Artifacts 새로고침',     run: () => emitEvent({ type: 'refresh' }) },
    { id: 'open-config',    label: 'open-config — config.json 편집',         run: () => openInEditor(CONFIG_FILE) },
    { id: 'open-product-hub', label: 'open-product-hub — 디렉토리 열기',     run: () => {
      try {
        spawn('tmux', ['new-window', '-c', cfg.productHubPath, '-n', 'hub'], { detached: true, stdio: 'ignore' }).unref();
      } catch {}
    }},
    { id: 'jira-debug',     label: 'jira-debug — acli 진단을 새 창에 표시',  run: () => {
      try {
        spawn('tmux', ['new-window', '-n', 'jira-debug',
          `bash -lc 'acli auth status; echo; echo "--- sample ---"; ` +
          `acli jira workitem search --jql "${cfg.jql.replace(/"/g, '\\"')}" --limit 3; ` +
          `echo; echo "(Press Enter to close)"; read'`,
        ], { detached: true, stdio: 'ignore' }).unref();
      } catch {}
    }},
    { id: 'restart-claude', label: 'restart-claude — 우측 pane의 claude 재시작', run: () => {
      // Reselect current epic to trigger respawn.
      // We don't know current selectedEpic here in pane process; daemon does.
      // Emit a synthetic "refresh+select" by re-emitting current selection via
      // a no-op event that daemon interprets — simplest is to ask user to press Enter again,
      // but we can also re-emit if the pane knows. For now: invoke 'refresh'.
      emitEvent({ type: 'refresh' });
    }},
    { id: 'kill-zax',       label: 'kill-zax — 세션과 daemon 종료',          run: () => {
      try { execFileSync('tmux', ['kill-session', '-t', cfg.tmuxSession],
                         { stdio: 'ignore' }); } catch {}
    }},
    { id: 'quit',           label: 'quit — daemon만 종료 (tmux 유지)',       run: () => emitEvent({ type: 'quit' }) },
  ];
};

export const CommandPalette: React.FC<{
  open: boolean;
  onClose: () => void;
  extra?: Command[];
}> = ({ open, onClose, extra }) => {
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);

  const cmds = [...baseCommands(), ...(extra ?? [])]
    .filter((c) => c.id.includes(query.toLowerCase()) || c.label.toLowerCase().includes(query.toLowerCase()));

  useInput((input, key) => {
    if (!open) return;
    if (key.escape) { onClose(); return; }
    if (key.return) {
      const chosen = cmds[cursor];
      if (chosen) chosen.run();
      onClose();
      return;
    }
    if (key.upArrow) setCursor((c) => Math.max(0, c - 1));
    else if (key.downArrow) setCursor((c) => Math.min(cmds.length - 1, c + 1));
    else if (key.backspace || key.delete) { setQuery((q) => q.slice(0, -1)); setCursor(0); }
    else if (input && !key.ctrl && !key.meta && input.length === 1 && input >= ' ') {
      setQuery((q) => q + input);
      setCursor(0);
    }
  }, { isActive: open });

  if (!open) return null;
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1} marginTop={1}>
      <Text>
        <Text color="cyan" bold>: </Text>
        <Text>{query}</Text>
        <Text color="cyan">_</Text>
      </Text>
      {cmds.length === 0 && <Text dimColor>(매치 없음)</Text>}
      {cmds.slice(0, 8).map((c, i) =>
        i === cursor ? (
          <Box key={c.id}>
            <Text color="cyan" bold>█</Text>
            <Text inverse bold> {`▶ ${c.label}`.padEnd(68)}</Text>
          </Box>
        ) : (
          <Box key={c.id}>
            <Text dimColor>│</Text>
            <Text>   {c.label}</Text>
          </Box>
        ),
      )}
      <Text dimColor>↑↓ 이동 · Enter 실행 · Esc 닫기</Text>
    </Box>
  );
};
