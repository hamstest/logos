import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { hash } from '../knowledge/model.js';

export async function textOrNull(file: string): Promise<string | null> {
  try { return await fs.readFile(file, 'utf8'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
}
export async function readJson<T>(file: string, fallback: T): Promise<T> {
  const text = await textOrNull(file);
  return text === null ? fallback : JSON.parse(text.replace(/^\uFEFF/, '')) as T;
}
export async function containedPath(base: string, relative: string): Promise<string> {
  const root = path.resolve(base);
  const target = path.resolve(root, relative);
  const rel = path.relative(root, target);
  if (path.isAbsolute(relative) || rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) throw new Error('Path must stay within its registered root');
  // Reject symlink traversal, including existing intermediate directories.
  let current = target;
  while (current !== path.dirname(root)) {
    try { if ((await fs.lstat(current)).isSymbolicLink()) throw new Error('Symlink paths are not supported for managed files'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    if (current === root) break;
    current = path.dirname(current);
  }
  return target;
}

/* @logos
format: 1
id: implementation/atomic-write
kind: implementation
links:
  - relation: implements
    target: criterion/recoverable-changes
*/
export async function atomicWrite(file: string, content: string, expected: string | null): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const lockPath = `${file}.logos-lock`;
  const lock = await fs.open(lockPath, 'wx').catch(error => {
    if (error.code === 'EEXIST') throw new Error(`File is being updated (or a previous writer left a lock): ${file}`);
    throw error;
  });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    const before = await textOrNull(file);
    if ((before === null ? null : hash(before)) !== expected) throw new Error('Edit conflict: reread the original before changing it');
    const handle = await fs.open(temporary, 'wx');
    try { await handle.writeFile(content, 'utf8'); await handle.sync(); } finally { await handle.close(); }
    const current = await textOrNull(file);
    if ((current === null ? null : hash(current)) !== expected) throw new Error('Edit conflict: original changed during update');
    if (expected === null) {
      await fs.link(temporary, file); // Exclusive publication: never replace an existing file on creation.
      await fs.unlink(temporary);
    } else await replaceChecked(temporary, file, expected);
  } finally {
    await fs.rm(temporary, { force: true });
    await lock.close();
    await fs.rm(lockPath, { force: true });
  }
}
export async function writeJson(file: string, value: unknown, expected?: string | null) {
  const before = await textOrNull(file);
  await atomicWrite(file, JSON.stringify(value, null, 2) + '\n', expected === undefined ? (before === null ? null : hash(before)) : expected);
}

// Windows indexers may briefly hold the destination. Recheck the original before every retry.
export async function replaceChecked(temporary: string, file: string, expected: string, rename = fs.rename) {
  for (let attempt = 0; ; attempt++) {
    const current = await textOrNull(file);
    if (current === null || hash(current) !== expected) throw new Error('Edit conflict: original changed before replacement');
    try { await rename(temporary, file); return; }
    catch (error) {
      if (!['EPERM', 'EBUSY', 'EACCES'].includes((error as NodeJS.ErrnoException).code ?? '') || attempt >= 7) throw error;
      await delay(20 * 2 ** attempt);
    }
  }
}