import { promises as fs } from 'node:fs';
import path from 'node:path';
import { containedPath } from '../host/files.js';
import type { SourceRoot } from '../config.js';
import { KnowledgeGraph } from './graph.js';
import type { ReadResult, Reader } from './model.js';

const ignored = new Set(['.git', '.logos', 'node_modules', 'dist', '.npm-cache']);
export async function loadGraph(roots: SourceRoot[], readers: Reader[]): Promise<KnowledgeGraph> {
  const results: ReadResult[] = [];
  const seen = new Map<string, string>();
  for (const root of roots) {
    async function walk(file: string): Promise<void> {
      const stat = await fs.lstat(file);
      if (stat.isSymbolicLink()) return;
      if (stat.isDirectory()) {
        for (const entry of (await fs.readdir(file)).sort()) if (!ignored.has(entry)) await walk(path.join(file, entry));
        return;
      }
      if (!stat.isFile()) return;
      const markdown = ['.md', '.markdown'].includes(path.extname(file).toLowerCase());
      if ((root.role === 'knowledge') !== markdown) return;
      const canonical = await fs.realpath(file);
      if (seen.has(canonical)) {
        if (seen.get(canonical) !== root.id) results.push({ nodes: [], diagnostics: [{ code: 'overlapping-root', message: 'File is already registered under root ' + seen.get(canonical), rootId: root.id, path: path.relative(root.path, file), scope: root.scope }] });
        return;
      }
      seen.set(canonical, root.id);
      const reader = readers.find(r => r.extensions.includes(path.extname(file).toLowerCase()));
      if (!reader) return;
      const text = await fs.readFile(file, 'utf8');
      results.push(reader.read({ rootId: root.id, path: path.relative(root.path, file).replaceAll('\\', '/'), text, scope: root.scope }));
    }
    for (const include of root.include) {
      try {
        if (root.optional) { try { await fs.stat(root.path); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; } }
        await walk(await containedPath(root.path, include));
      }
      catch (error) { results.push({ nodes: [], diagnostics: [{ code: 'source-read', message: String(error), rootId: root.id, path: include, scope: root.scope }] }); }
    }
  }
  return new KnowledgeGraph(results);
}
