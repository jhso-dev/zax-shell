import React, { useEffect, useState } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import { join } from 'node:path';
import { subscribeState, emitEvent } from '../ipc/store.js';
import type { SharedState, Artifact } from '../ipc/state.js';
import { useCursorScroll } from './useCursorScroll.js';
import { truncateToWidth, padToWidth } from './text-width.js';
import { Toast } from './Toast.js';

const stateGlyph = (s: Artifact['state']): { ch: string; color: string; label: string } => {
  switch (s) {
    case 'ok':      return { ch: '✓', color: 'green',  label: 'ok' };
    case 'drift':   return { ch: '◐', color: 'yellow', label: 'drift' };
    case 'stale':   return { ch: '⚠', color: 'red',    label: 'stale' };
    case 'missing': return { ch: '·', color: 'gray',   label: 'missing' };
  }
};

const stageLabel = (a: Artifact): { glyph: string; label: string } => {
  if (a.stage === 'other' && /\.html?$/i.test(a.path)) {
    return { glyph: 'H', label: 'HTML' };
  }
  switch (a.stage) {
    case 'prd':           return { glyph: 'P', label: 'PRD' };
    case 'architecture':  return { glyph: 'A', label: 'Arch' };
    case 'spec':          return { glyph: 'S', label: 'Spec' };
    case 'test-case':     return { glyph: 'T', label: 'Test' };
    default:              return { glyph: '?', label: 'other' };
  }
};

export const ArtifactsPane: React.FC<{ productHubPath: string }> = ({ productHubPath }) => {
  const { stdout } = useStdout();
  const [state, setState] = useState<SharedState | null>(null);
  const [stdoutRows, setStdoutRows] = useState(stdout?.rows ?? 30);
  const [stdoutCols, setStdoutCols] = useState(stdout?.columns ?? 80);

  useEffect(() => subscribeState(productHubPath, setState), [productHubPath]);

  useEffect(() => {
    if (!stdout) return;
    const onResize = () => {
      setStdoutRows(stdout.rows);
      setStdoutCols(stdout.columns);
    };
    stdout.on('resize', onResize);
    onResize();
    return () => { stdout.off('resize', onResize); };
  }, [stdout]);

  const artifacts: Artifact[] = (state && state.selectedEpic && state.artifacts[state.selectedEpic]) || [];
  const selectedEpic = state?.selectedEpic
    ? (state.epics.find((e) => e.key === state.selectedEpic)
       ?? state.epicSearch?.results.find((e) => e.key === state.selectedEpic))
    : undefined;
  const selectedEpicFolder = selectedEpic?.folder;
  const selectedEpicBranch = selectedEpic?.branch;

  const showHubToast = state?.toast && (state.toast.pane === undefined || state.toast.pane === 'hub');
  const reserved = showHubToast ? 5 : 4;
  const listRows = Math.max(3, stdoutRows - reserved);
  const list = useCursorScroll(artifacts, listRows);

  useEffect(() => { list.jumpTo(0); }, [state?.selectedEpic]); // eslint-disable-line react-hooks/exhaustive-deps

  useInput((input, key) => {
    if (input === 'q') { emitEvent({ type: 'confirm-quit' }); return; }
    if (input === 'r') { emitEvent({ type: 'refresh-hub' }); return; }
    if (input === 'b') {
      if (state?.selectedEpic) emitEvent({ type: 'switch-branch', epicKey: state.selectedEpic });
      return;
    }

    if (input === 'o') {
      const key = state?.selectedEpic;
      if (!key) return;
      const cur = artifacts[list.cursor];
      const org = process.env.ZAX_SHELL_GH_ORG ?? 'zigbang';
      const repo = process.env.ZAX_SHELL_PRODUCT_HUB_REPO ?? 'product-hub';
      if (cur && selectedEpicFolder) {
        // Cursor on a file → open that file's blob page on GitHub. Use the
        // feat branch if the epic lives there, otherwise the default branch.
        const ref = selectedEpic?.branch
          ? selectedEpic.branch.replace(/^origin\//, '')
          : 'master';
        const path = `epics/${selectedEpicFolder}/${cur.path}`.split('/').map(encodeURIComponent).join('/');
        emitEvent({
          type: 'open-browser',
          url: `https://github.com/${org}/${repo}/blob/${ref}/${path}`,
        });
      } else {
        // No artifact under cursor → org-wide PR search for the epic key.
        const q = encodeURIComponent(`org:${org} ${key}`);
        emitEvent({ type: 'open-browser', url: `https://github.com/search?q=${q}&type=pullrequests` });
      }
      return;
    }

    if (artifacts.length === 0) return;
    if (key.upArrow || input === 'k')        list.moveUp();
    else if (key.downArrow || input === 'j') list.moveDown();
    else if (key.pageUp)                     list.pageUp();
    else if (key.pageDown)                   list.pageDown();
    else if (input === 'G')                  list.toBottom();
    else if (key.return && state && selectedEpicFolder && selectedEpic?.worktreePath) {
      const a = artifacts[list.cursor];
      if (!a) return;
      emitEvent({
        type: 'open-file',
        absPath: join(selectedEpic.worktreePath, 'epics', selectedEpicFolder, a.path),
      });
    }
  });

  if (!state) return <Text dimColor>로딩…</Text>;

  if (!state.productHubExists) {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Box flexDirection="column" borderStyle="round" borderColor="red" paddingX={1}>
          <Text color="red" bold>✗ product-hub 없음</Text>
          <Text dimColor>{state.productHubPath}</Text>
          <Text> </Text>
          <Text>실행:</Text>
          <Text color="cyan">  gh repo clone zigbang/product-hub ~/dev/product-hub</Text>
        </Box>
      </Box>
    );
  }

  const currentArtifact = artifacts[list.cursor];

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text wrap="truncate" bold>
        {(() => {
          if (!state.selectedEpic) return '에픽 미선택';
          const cursorPart = artifacts.length > 0 && currentArtifact
            ? `  →  ${list.cursor + 1}/${artifacts.length}  ${currentArtifact.path.split('/').pop()}`
            : '';
          const branchTag = selectedEpicBranch
            ? `  (${selectedEpicBranch.replace(/^origin\//, '')})`
            : '';
          return `${state.selectedEpic}${branchTag}${cursorPart}`;
        })()}
      </Text>
      <Text dimColor wrap="truncate">↑↓ Enter · r Hub갱신 · b 브랜치 · o GitHub · ✓ok ◐drift ⚠stale</Text>

      {!state.selectedEpic ? (
        <Text dimColor wrap="truncate">좌측에서 에픽을 선택하세요</Text>
      ) : artifacts.length === 0 ? (
        <Text dimColor wrap="truncate">
          {selectedEpicFolder
            ? `산출물 없음 (epics/${selectedEpicFolder})`
            : '이 에픽 키에 매칭되는 product-hub 폴더가 없습니다'}
        </Text>
      ) : (
        <Box flexDirection="column">
          {list.before > 0 && <Text dimColor wrap="truncate">  ↑ {list.before} more</Text>}
          {list.visible.map((a, idx) => {
            const i = list.viewportStart + idx;
            const active = i === list.cursor;
            const g = stateGlyph(a.state);
            const stage = stageLabel(a);
            // 11 cells reserved before the path (█▶ + state + stage + spaces).
            const contentW = Math.max(20, stdoutCols - 2);
            const budget = Math.max(0, contentW - 11);
            const pathRaw = truncateToWidth(a.path, budget);
            const display = active ? padToWidth(pathRaw, budget) : pathRaw;
            const rowText = `▶ ${g.ch} ${stage.glyph} ${display}`;
            if (active) {
              return (
                <Box key={a.path}>
                  <Text color="cyan" bold>█</Text>
                  <Text inverse bold>{` ${rowText}`}</Text>
                </Box>
              );
            }
            return (
              <Box key={a.path}>
                <Text dimColor>│  </Text>
                <Text color={g.color} bold>{g.ch}</Text>
                <Text dimColor>{` ${stage.glyph}`}</Text>
                <Text>{` ${display}`}</Text>
              </Box>
            );
          })}
          {list.after > 0 && <Text dimColor wrap="truncate">  ↓ {list.after} more</Text>}
        </Box>
      )}

      <Toast toast={state?.toast} acceptPane="hub" />
    </Box>
  );
};
