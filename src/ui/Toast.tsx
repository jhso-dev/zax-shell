import React, { useEffect, useState } from 'react';
import { Text } from 'ink';
import type { Toast as ToastT } from '../ipc/state.js';

interface Props {
  toast: ToastT | undefined;
  ttlMs?: number;
  /** Render only toasts tagged with this pane (undefined = global). */
  acceptPane?: 'epics' | 'hub';
}

const COLOR: Record<ToastT['level'], string> = {
  info:    'cyan',
  success: 'green',
  warn:    'yellow',
  error:   'red',
};

const GLYPH: Record<ToastT['level'], string> = {
  info:    'ℹ',
  success: '✓',
  warn:    '⚠',
  error:   '✗',
};

export const Toast: React.FC<Props> = ({ toast, ttlMs = 3000, acceptPane }) => {
  const [visible, setVisible] = useState(false);

  // Only render toasts whose pane matches (or have no pane = global).
  const matches = !toast || toast.pane === undefined || toast.pane === acceptPane;

  useEffect(() => {
    if (!toast || !matches) { setVisible(false); return; }
    const age = Date.now() - new Date(toast.createdAt).getTime();
    if (age > ttlMs) { setVisible(false); return; }
    setVisible(true);
    const remaining = Math.max(0, ttlMs - age);
    const t = setTimeout(() => setVisible(false), remaining);
    return () => clearTimeout(t);
  }, [toast, ttlMs, matches]);

  if (!visible || !toast || !matches) return null;
  return (
    <Text wrap="truncate" color={COLOR[toast.level]}>
      {`${GLYPH[toast.level]} ${toast.text}`}
    </Text>
  );
};
