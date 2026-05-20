import { existsSync, mkdirSync, renameSync, cpSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const HOME = homedir();
const NEW_BASE     = join(HOME, '.zax-shell');
const NEW_STATE    = join(NEW_BASE, 'state');
const NEW_CONFIG   = join(NEW_BASE, 'config');

const LEGACY_STATE  = join(HOME, '.cache', 'zax-shell');
const LEGACY_CONFIG = join(HOME, '.config', 'zax-shell');

// Move src → dst, falling back to copy+delete across filesystems.
function moveDir(src: string, dst: string): boolean {
  try {
    renameSync(src, dst);
    return true;
  } catch {
    try {
      mkdirSync(dst, { recursive: true });
      cpSync(src, dst, { recursive: true });
      rmSync(src, { recursive: true, force: true });
      return true;
    } catch { return false; }
  }
}

/**
 * One-shot migration from the pre-0.2 layout (~/.cache/zax-shell, ~/.config/zax-shell)
 * to the unified ~/.zax-shell/{state,config}/. Skips silently when the
 * destination already exists or nothing legacy to migrate.
 */
export function migrateLegacyLayout(): void {
  if (!existsSync(NEW_BASE)) mkdirSync(NEW_BASE, { recursive: true });

  const moved: string[] = [];
  if (existsSync(LEGACY_STATE) && !existsSync(NEW_STATE)) {
    if (moveDir(LEGACY_STATE, NEW_STATE)) moved.push(`${LEGACY_STATE} → ${NEW_STATE}`);
  }
  if (existsSync(LEGACY_CONFIG) && !existsSync(NEW_CONFIG)) {
    if (moveDir(LEGACY_CONFIG, NEW_CONFIG)) moved.push(`${LEGACY_CONFIG} → ${NEW_CONFIG}`);
  }

  if (moved.length > 0) {
    console.error('▶ zax-shell 데이터 통합 마이그레이션:');
    for (const m of moved) console.error(`    ${m}`);
    console.error('');
  }
}
