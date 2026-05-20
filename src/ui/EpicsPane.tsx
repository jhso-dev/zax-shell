import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import { subscribeState, emitEvent } from '../ipc/store.js';
import type { SharedState, Epic } from '../ipc/state.js';
import { CommandPalette } from './CommandPalette.js';
import { Toast } from './Toast.js';
import { statusColor, statusBadge } from './status-color.js';
import { loadPrefs, savePrefs } from '../ipc/ui-prefs.js';
import { useCursorScroll } from './useCursorScroll.js';
import { truncateToWidth, padToWidth } from './text-width.js';

const summarizeStatuses = (epics: Epic[]): { label: string; count: number; color: string | undefined }[] => {
  const counts = new Map<string, number>();
  for (const e of epics) {
    const s = (e.status ?? '').trim() || '기타';
    counts.set(s, (counts.get(s) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([label, count]) => ({ label, count, color: statusColor(label) }));
};

const projectPrefix = (key: string): string => {
  const m = key.match(/^([A-Z][A-Z0-9]*)-/);
  return m ? m[1]! : key;
};

const SetupBanner: React.FC<{ state: SharedState }> = ({ state }) => {
  if (!state.health) return null;
  const acli = state.health.acli;
  const gh = state.health.gh;

  const issues: { tool: string; status: string; cmd: string }[] = [];
  if (acli === 'missing')  issues.push({ tool: 'acli', status: '설치 필요',     cmd: 'brew tap atlassian/homebrew-acli && brew install acli' });
  if (acli === 'unauthed') issues.push({ tool: 'acli', status: '인증 필요',     cmd: 'acli auth login' });
  if (gh === 'missing')    issues.push({ tool: 'gh',   status: '설치 필요',     cmd: 'brew install gh' });
  if (gh === 'unauthed')   issues.push({ tool: 'gh',   status: '인증 필요',     cmd: 'gh auth login' });

  if (issues.length === 0) return null;
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1}>
      <Text color="yellow" bold>⚙ 초기 셋업이 필요합니다</Text>
      {issues.map((it) => (
        <Box key={it.tool} flexDirection="column">
          <Text>
            <Text color="yellow" bold>{it.tool}</Text>
            <Text dimColor>  </Text>
            <Text>{it.status}</Text>
          </Text>
          <Text color="cyan">  $ {it.cmd}</Text>
        </Box>
      ))}
      <Text dimColor>완료 후 r 키로 새로고침</Text>
    </Box>
  );
};

const ActionBanner: React.FC<{ state: SharedState }> = ({ state }) => {
  const jira = state.jiraStatus;
  if (jira.startsWith('error')) {
    return (
      <Box flexDirection="column" borderStyle="round" borderColor="red" paddingX={1}>
        <Text color="red" bold>✗ Jira 오류</Text>
        <Text>{jira.slice('error:'.length).trim()}</Text>
        <Text dimColor>zax-shell --jira-debug 로 진단</Text>
      </Box>
    );
  }
  if (jira === 'loading' && state.epics.length === 0) {
    return <Text dimColor>⌛ Jira 조회 중…</Text>;
  }
  if (jira === 'ok' && state.epics.length === 0) {
    return (
      <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1}>
        <Text color="yellow" bold>참여 에픽이 0건</Text>
        <Text>점검:</Text>
        <Text>  · acli auth status  — 사이트 확인</Text>
        <Text>  · ~/.config/zax-shell/config.json  — JQL 확인</Text>
        <Text dimColor>zax-shell --jira-debug 로 자동 점검</Text>
      </Box>
    );
  }
  return null;
};

type SortMode = 'updated' | 'key' | 'status';

const sortEpics = (epics: Epic[], mode: SortMode): Epic[] => {
  const arr = [...epics];
  if (mode === 'key') {
    arr.sort((a, b) => a.key.localeCompare(b.key));
  } else if (mode === 'status') {
    arr.sort((a, b) => (a.status ?? '').localeCompare(b.status ?? '') || a.key.localeCompare(b.key));
  }
  // 'updated' is the default order from the daemon (Jira ORDER BY updated DESC)
  return arr;
};

export const EpicsPane: React.FC<{ productHubPath: string }> = ({ productHubPath }) => {
  const { stdout } = useStdout();
  const initialPrefs = useRef(loadPrefs()).current;
  const [state, setState] = useState<SharedState | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [filtering, setFiltering] = useState(false);
  const [searching, setSearching] = useState(false);
  const [searchInput, setSearchInput] = useState('');
  const [query, setQuery] = useState(initialPrefs.query ?? '');
  const [projectFilter, setProjectFilter] = useState<string | null>(initialPrefs.projectFilter ?? null);
  const [sortMode, setSortMode] = useState<SortMode>(initialPrefs.sortMode ?? 'updated');
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

  const projects = useMemo<string[]>(() => {
    if (!state) return [];
    const counts = new Map<string, number>();
    for (const e of state.epics) {
      const p = projectPrefix(e.key);
      counts.set(p, (counts.get(p) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([p]) => p);
  }, [state]);

  const filtered = useMemo<Epic[]>(() => {
    if (!state) return [];
    const inSearch = !!state.epicSearch;
    let arr: Epic[] = inSearch ? state.epicSearch!.results : state.epics;
    if (!inSearch && projectFilter) arr = arr.filter((e) => projectPrefix(e.key) === projectFilter);
    if (query.trim()) {
      const q = query.toLowerCase();
      arr = arr.filter((e) =>
        e.key.toLowerCase().includes(q) ||
        e.summary.toLowerCase().includes(q) ||
        (e.status ?? '').toLowerCase().includes(q),
      );
    }
    return sortEpics(arr, sortMode);
  }, [state, query, projectFilter, sortMode]);

  // Count every row that renders OUTSIDE the item list, so the list height
  // never overflows the pane (which would scroll the top off the screen).
  //   1 header  ·  1 status-summary  ·  1 hint  ·  1 ↑more  ·  1 ↓more
  let reserved = 5;
  if (filtering) reserved += 1;
  if (searching) reserved += 1;
  if (state?.epicSearch && !searching) reserved += 1;  // result status row
  if (state?.toast) reserved += 1;
  const acliBad = state?.health && state.health.acli !== 'ok';
  const ghBad   = state?.health && state.health.gh   !== 'ok';
  const setupIssues = (acliBad ? 1 : 0) + (ghBad ? 1 : 0);
  if (setupIssues > 0) {
    reserved += 4 + setupIssues * 2;            // borders + title + (label+cmd) per issue + hint
  }
  if (state && (state.epics.length === 0 || state.jiraStatus !== 'ok')) {
    reserved += 5;                              // action banner: borders + title + 3 body lines
  }
  const listRows = Math.max(3, stdoutRows - reserved);

  const list = useCursorScroll(filtered, listRows);

  // Reset cursor whenever the underlying list changes.
  useEffect(() => { list.jumpTo(0); }, [query, projectFilter, sortMode]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { list.jumpTo(0); }, [state?.epicSearch?.query, state?.epicSearch?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { savePrefs({ query, projectFilter, sortMode }); },
    [query, projectFilter, sortMode]);
  useEffect(() => {
    if (state?.selectedEpic) savePrefs({ selectedEpicKey: state.selectedEpic });
  }, [state?.selectedEpic]);

  const cycleProjectFilter = () => {
    if (!projects.length) return;
    const idx = projectFilter == null ? -1 : projects.indexOf(projectFilter);
    const next = idx + 1;
    setProjectFilter(next >= projects.length ? null : (projects[next] ?? null));
  };

  const cycleSort = () => {
    const order: SortMode[] = ['updated', 'key', 'status'];
    const i = order.indexOf(sortMode);
    setSortMode(order[(i + 1) % order.length]!);
  };

  const handleEnter = () => {
    const epic = filtered[list.cursor];
    if (epic) emitEvent({ type: 'select-epic', epicKey: epic.key });
  };

  useInput((input, key) => {
    if (paletteOpen) return;

    if (searching) {
      if (key.escape) { setSearching(false); setSearchInput(''); return; }
      if (key.return) {
        const q = searchInput.trim();
        if (q) emitEvent({ type: 'jira-search', query: q });
        setSearching(false);
        return;
      }
      if (key.backspace || key.delete) { setSearchInput((q) => q.slice(0, -1)); return; }
      if (input && !key.ctrl && !key.meta && input.length === 1 && input >= ' ') {
        setSearchInput((q) => q + input);
      }
      return;
    }

    if (filtering) {
      if (key.escape) { setFiltering(false); setQuery(''); return; }
      if (key.return) { setFiltering(false); handleEnter(); return; }
      if (key.backspace || key.delete) { setQuery((q) => q.slice(0, -1)); return; }
      if (key.upArrow) { list.moveUp(); return; }
      if (key.downArrow) { list.moveDown(); return; }
      if (input && !key.ctrl && !key.meta && input.length === 1 && input >= ' ') {
        setQuery((q) => q + input);
      }
      return;
    }

    if (input === ':') { setPaletteOpen(true); return; }
    if (input === '?') { emitEvent({ type: 'show-help' }); return; }
    if (input === '/') { setFiltering(true); setQuery(''); return; }
    if (input === 's') {
      setSearching(true);
      setSearchInput(state?.epicSearch?.query ?? '');
      return;
    }
    if (input === 'p') { cycleProjectFilter(); return; }
    if (input === 'S') { cycleSort(); return; }
    if (key.escape) {
      // Esc precedence: clear broad search results first, then local filters.
      if (state?.epicSearch) { emitEvent({ type: 'jira-search-clear' }); return; }
      if (query || projectFilter) { setQuery(''); setProjectFilter(null); return; }
    }

    if (input === 'q') { emitEvent({ type: 'confirm-quit' }); return; }

    if (!state || filtered.length === 0) return;

    if (key.upArrow || input === 'k')        list.moveUp();
    else if (key.downArrow || input === 'j') list.moveDown();
    else if (key.pageUp)                     list.pageUp();
    else if (key.pageDown)                   list.pageDown();
    else if (input === 'G')                  list.toBottom();
    else if (key.return)                     handleEnter();
    else if (input === 'd') {
      const e = filtered[list.cursor];
      if (e) emitEvent({ type: 'show-jira-detail', epicKey: e.key });
    } else if (input === 'g') {
      const e = filtered[list.cursor];
      if (e) emitEvent({ type: 'show-gh-dash', epicKey: e.key });
    } else if (input === 'o') {
      const e = filtered[list.cursor];
      if (e?.url) emitEvent({ type: 'open-browser', url: e.url });
    }
  });

  const summary = state ? summarizeStatuses(state.epics) : [];
  const currentEpic = filtered[list.cursor];

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text wrap="truncate" bold>
        {(() => {
          const inSearch = !!state?.epicSearch;
          const total = inSearch
            ? state!.epicSearch!.results.length
            : (state?.epics.length ?? 0);
          const countLabel = filtered.length !== total
            ? `(${filtered.length}/${total})` : `(${filtered.length})`;
          const cursorInfo = currentEpic
            ? `  →  ${list.cursor + 1}/${filtered.length}  ${currentEpic.key}`
            : '';
          if (inSearch) {
            return `🔍 Search "${state!.epicSearch!.query}"  ${countLabel}${cursorInfo}  · sort:${sortMode}`;
          }
          const projectInfo = `  프로젝트:${projectFilter ?? '전체'}`;
          return `Epics  ${countLabel}${cursorInfo}${projectInfo}  · sort:${sortMode}`;
        })()}
      </Text>

      {summary.length > 0 && !state?.epicSearch && (
        <Text wrap="truncate" dimColor>
          {summary.map((s) => `${s.count} ${s.label}`).join('  ·  ')}
        </Text>
      )}

      {state?.epicSearch && !searching && (
        <Text wrap="truncate" dimColor>
          {state.epicSearch.status === 'loading'
            ? '⌛ Jira 검색 중…'
            : state.epicSearch.status === 'error'
              ? `✗ ${state.epicSearch.message ?? '검색 실패'}`
              : `${state.epicSearch.results.length}건 · s 재검색 · Esc 검색 해제`}
        </Text>
      )}

      <Text dimColor wrap="truncate">↑↓ Enter · / 필터 · s Jira검색 · d 상세 · g GitHub · o Jira웹 · ?</Text>

      {filtering && (
        <Text wrap="truncate">
          <Text color="cyan">/ </Text>
          <Text>{query}</Text>
          <Text color="cyan">_</Text>
        </Text>
      )}

      {searching && (
        <Text wrap="truncate">
          <Text color="magenta">🔍 search jira: </Text>
          <Text>{searchInput}</Text>
          <Text color="magenta">_</Text>
        </Text>
      )}

      {state && <SetupBanner state={state} />}
      {state && (state.epics.length === 0 || state.jiraStatus !== 'ok') && (
        <ActionBanner state={state} />
      )}

      {state == null ? (
        <Text dimColor>로딩…</Text>
      ) : filtered.length === 0 && state.epics.length > 0 ? (
        <Text dimColor>매치 없음 (Esc 로 해제)</Text>
      ) : filtered.length === 0 ? null : (
        <Box flexDirection="column">
          {list.before > 0 && <Text dimColor wrap="truncate">  ↑ {list.before} more</Text>}
          {list.visible.map((e, idx) => {
            const i = list.viewportStart + idx;
            const active = i === list.cursor;
            const selected = state.selectedEpic === e.key;
            const sColor = statusColor(e.status);
            const badge = statusBadge(e.status);
            const contentW = Math.max(20, stdoutCols - 2);
            const dot = selected ? '●' : '○';
            const keyCol = e.key.padEnd(11);
            const badgeCol = badge ? padToWidth(`[${badge}]`, 14) : ' '.repeat(14);
            // 36 cells reserved before the title (█▶○+key+badge+spaces).
            // Inactive row uses 35; we overpad so inactive has 1 cell slack.
            const titleBudget = Math.max(0, contentW - 36);
            const titleRaw = truncateToWidth(e.summary, titleBudget);
            const title = active ? padToWidth(titleRaw, titleBudget) : titleRaw;
            const rowText = `▶ ${dot} ${keyCol} ${badgeCol} ${title}`;
            if (active) {
              return (
                <Box key={e.key}>
                  <Text color="cyan" bold>█</Text>
                  <Text inverse bold>{` ${rowText}`}</Text>
                </Box>
              );
            }
            const inactive = `│   ${dot} ${keyCol} `;
            return (
              <Box key={e.key}>
                <Text dimColor>{inactive}</Text>
                {badge
                  ? <Text color={sColor} bold>{badgeCol}</Text>
                  : <Text>{badgeCol}</Text>}
                <Text>{` ${title}`}</Text>
              </Box>
            );
          })}
          {list.after > 0 && <Text dimColor wrap="truncate">  ↓ {list.after} more</Text>}
        </Box>
      )}

      <Toast toast={state?.toast} />

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </Box>
  );
};
