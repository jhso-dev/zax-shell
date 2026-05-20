import React, { useEffect, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { subscribeState, emitEvent } from '../ipc/store.js';
import type { SharedState, StageStatus } from '../ipc/state.js';

const relativeTime = (iso: string | undefined): string => {
  if (!iso) return '—';
  const diffSec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (!Number.isFinite(diffSec) || diffSec < 0) return '—';
  if (diffSec < 2) return 'now';
  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  return `${Math.floor(diffSec / 86400)}d ago`;
};

const jiraIndicator = (status: string): { color: string; text: string } => {
  if (status === 'ok')          return { color: 'green',  text: '● jira' };
  if (status === 'loading')     return { color: 'yellow', text: '◌ jira' };
  if (status.startsWith('paused')) return { color: 'red', text: '⏸ jira' };
  return { color: 'red', text: '✗ jira' };
};

export const DashboardPane: React.FC<{ productHubPath: string }> = ({ productHubPath }) => {
  const [state, setState] = useState<SharedState | null>(null);
  const [, force] = useState(0);
  useEffect(() => subscribeState(productHubPath, setState), [productHubPath]);

  // Tick once a second so "5s ago" updates without state change.
  useEffect(() => {
    const t = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  // Swallow all keystrokes so cooked-mode line-feeds don't jitter the render
  // when this pane has tmux focus. Forward the few keys that should work
  // regardless of focus.
  useInput((input) => {
    if (input === 'r') {
      // Dashboard 'r' is a "refresh everything" power-user shortcut.
      emitEvent({ type: 'refresh-jira' });
      emitEvent({ type: 'refresh-hub' });
    } else if (input === 'q') emitEvent({ type: 'confirm-quit' });
  });

  if (!state) return <Text dimColor>Loading dashboard…</Text>;

  const db = state.dashboard;
  const stages: StageStatus[] = db?.stages ?? [
    { stage: 'prd', glyph: '·' },
    { stage: 'architecture', glyph: '·' },
    { stage: 'spec', glyph: '·' },
    { stage: 'test-case', glyph: '·' },
  ];

  const ji = jiraIndicator(state.jiraStatus);

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text wrap="truncate">
        {(() => {
          const epic = db?.epicKey
            ? `${db.epicKey}  ${(db.epicSummary ?? '').slice(0, 50)}`
            : '에픽 미선택 — 좌측 패널에서 ↑↓ 후 Enter';
          const stagesStr = stages
            .map((s) => `${s.glyph}${s.stage[0]!.toUpperCase()}`)
            .join(' ');
          const drift = `drift ${db?.driftCount ?? 0}`;
          const stale = `stale ${db?.staleCount ?? 0}`;
          return `ZAX  │  ${epic}  │  Stages: ${stagesStr}  │  ${drift}  ${stale}`;
        })()}
      </Text>
      <Text wrap="truncate" dimColor>
        {(() => {
          const legend = 'legend  ✓ ok · ◐ drift · ⚠ stale · · missing';
          const jira = `${ji.text}`;
          const health = state.health
            ? `  ${state.health.acli === 'ok' ? '●' : state.health.acli === 'missing' ? '✗' : '◌'} acli` +
              `  ${state.health.gh === 'ok' ? '●' : state.health.gh === 'missing' ? '✗' : '◌'} gh`
            : '';
          return `${legend}      ${jira}${health}  ·  updated ${relativeTime(state.updatedAt)}`;
        })()}
      </Text>
    </Box>
  );
};

