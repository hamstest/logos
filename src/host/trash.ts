import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { atomicWrite, containedPath, readJson, textOrNull, writeJson } from './files.js';
import { hash } from '../knowledge/model.js';
export const recordSchema = z.object({ id: z.string().uuid(), root: z.string(), relative: z.string(), ids: z.array(z.string()), start: z.number().int().nonnegative(), fragment: z.string(), beforeHash: z.string(), afterHash: z.string(), state: z.enum(['prepared', 'deleted', 'restored']), createdAt: z.string() });
export type TrashRecord = z.infer<typeof recordSchema>;
export async function trashList(workspace: string): Promise<TrashRecord[]> {
  const directory = path.join(workspace, '.logos/trash');
  const entries = await fs.readdir(directory).catch(e => { if (e.code === 'ENOENT') return []; throw e; });
  return Promise.all(entries.filter(e => e.endsWith('.json')).map(async name => recordSchema.parse(await readJson(path.join(directory, name), null))));
}
export async function removeFragment(workspace: string, root: string, relative: string, start: number, end: number, expectedHash: string, ids: string[]) {
  const file = await containedPath(root, relative);
  const text = await textOrNull(file);
  if (text === null || hash(text) !== expectedHash) throw new Error('Edit conflict: reread before deleting');
  const after = text.slice(0, start) + text.slice(end);
  const record: TrashRecord = { id: randomUUID(), root, relative, ids, start, fragment: text.slice(start, end), beforeHash: expectedHash, afterHash: hash(after), state: 'prepared', createdAt: new Date().toISOString() };
  const recordFile = path.join(workspace, '.logos/trash', record.id + '.json');
  await writeJson(recordFile, record, null); // Preserve the raw original before any source mutation.
  await atomicWrite(file, after, expectedHash);
  record.state = 'deleted'; await writeJson(recordFile, record);
  return record;
}
export async function restoreFragment(workspace: string, id: string, existingIds: string[]) {
  z.string().uuid().parse(id);
  const recordFile = path.join(workspace, '.logos/trash', id + '.json');
  const record = recordSchema.parse(await readJson(recordFile, null));
  if (record.state === 'restored') throw new Error('Already restored');
  const file = await containedPath(record.root, record.relative);
  const current = await textOrNull(file);
  if (current !== null && hash(current) === record.beforeHash && record.state === 'prepared') return { ...record, recovery: 'Original is intact; deletion did not take effect' };
  if (current === null || hash(current) !== record.afterHash) throw new Error('Restore conflict: surrounding content changed; original fragment remains in trash');
  if (record.ids.some(id => existingIds.includes(id))) throw new Error('Restore conflict: an ID is already in use');
  await atomicWrite(file, current.slice(0, record.start) + record.fragment + current.slice(record.start), record.afterHash);
  record.state = 'restored'; await writeJson(recordFile, record);
  return record;
}
