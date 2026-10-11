import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** True when a content file path points at a PDF that is actually in public/. */
export function uploadExists(file: string | undefined | null): file is string {
  if (!file?.startsWith('/uploads/')) return false;
  return existsSync(join(process.cwd(), 'public', file.slice(1)));
}
