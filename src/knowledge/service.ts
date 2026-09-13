import path from 'node:path';
import { configuration, sourceRoots } from '../config.js';
import type { Host } from '../host/host.js';
import { KnowledgeIndex } from './load.js';

const indexes = new WeakMap<Host, KnowledgeIndex>();
export async function graphFor(host: Host) {
  let index = indexes.get(host);
  if (!index) { index = new KnowledgeIndex(path.join(host.workspace, '.logos/index.json')); indexes.set(host, index); const current = index; host.disposers.push(() => current.close()); }
  const roots = await sourceRoots(host.workspace, await configuration(host.workspace));
  if (host.readers.some(r => r.id === 'task-record')) roots.push({ id: 'records', path: host.workspace, include: ['.logos/tasks'], role: 'source', scope: 'shared', optional: true });
  return index.sync(roots, host.readers);
}
// @logos-id knowledge-service
