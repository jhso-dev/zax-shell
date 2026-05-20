import { join } from 'node:path';
import { existsSync } from 'node:fs';
import chokidar from 'chokidar';

/**
 * Watch <productHubPath>/epics/ recursively for .md changes.
 * Debounces a flurry of events into a single onChange call.
 */
export function startWatcher(productHubPath: string, onChange: () => void): () => void {
  const epicsRoot = join(productHubPath, 'epics');
  if (!existsSync(epicsRoot)) return () => {};

  const watcher = chokidar.watch(epicsRoot, {
    ignored: (path: string) =>
      path.includes('/node_modules/') || path.includes('/.git/'),
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 50 },
  });

  let timer: NodeJS.Timeout | undefined;
  const trigger = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(onChange, 120);
  };

  watcher.on('add', trigger);
  watcher.on('change', trigger);
  watcher.on('unlink', trigger);
  watcher.on('addDir', trigger);
  watcher.on('unlinkDir', trigger);

  return () => {
    if (timer) clearTimeout(timer);
    void watcher.close();
  };
}
