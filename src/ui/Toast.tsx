import React, { useEffect, useState } from 'react';
import { Text } from 'ink';
import type { Toast as ToastT } from '../ipc/state.js';

interface Props {
  toast: ToastT | undefined;
  /** Hide after N ms since createdAt. */
  ttlMs?: number;
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

export const Toast: React.FC<Props> = ({ toast, ttlMs = 3000 }) => {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!toast) { setVisible(false); return; }
    const age = Date.now() - new Date(toast.createdAt).getTime();
    if (age > ttlMs) { setVisible(false); return; }
    setVisible(true);
    const remaining = Math.max(0, ttlMs - age);
    const t = setTimeout(() => setVisible(false), remaining);
    return () => clearTimeout(t);
  }, [toast, ttlMs]);

  if (!visible || !toast) return null;
  return (
    <Text wrap="truncate" color={COLOR[toast.level]}>
      {`${GLYPH[toast.level]} ${toast.text}`}
    </Text>
  );
};
