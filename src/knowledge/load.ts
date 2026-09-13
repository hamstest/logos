import { z } from 'zod';
import { nodeSchema, diagnosticSchema } from './contracts.js';
import { promises as fs, watch, type FSWatcher } from 'node:fs';
import path from 'node:path';
import { containedPath, atomicWrite, textOrNull } from '../host/files.js';
import type { SourceRoot } from '../config.js';
import { KnowledgeGraph } from './graph.js';
import { hash, type ReadResult, type Reader } from './model.js';

const ignored = new Set(['.git', '.logos', 'node_modules', 'dist', '.npm-cache']);
interface Entry { stamp: string; result: ReadResult }
export class KnowledgeIndex {
  private entries: Record<string, Entry> = {};
  private graph?: KnowledgeGraph;
  private initialized = false;
  private closed = false;
  private pending?: NodeJS.Timeout;
  private config = '';
  private queue: Promise<unknown> = Promise.resolve();
  private watchers: FSWatcher[] = [];
  private watched = '';
  constructor(private cache?: string) {}
  close() { this.closed = true; clearTimeout(this.pending); for (const w of this.watchers) w.close(); this.watchers = []; this.watched = ''; }
  sync(roots: SourceRoot[], readers: Reader[]) {
    const result = this.queue.then(() => this.refresh(roots, readers));
    this.queue = result.catch(() => {}); return result;
  }
  private async refresh(roots: SourceRoot[], readers: Reader[]): Promise<KnowledgeGraph> {
    if (this.closed) { if (this.graph) return this.graph; throw new Error('Index closed'); }
    const config = JSON.stringify([roots, readers.map(r => [r.id, r.extensions])]);
    if (!this.initialized) {
      this.initialized = true;
      if (this.cache) try {
        const saved = z.object({ format: z.literal(4), config: z.string(), entries: z.record(z.string(), z.object({ stamp: z.string(), result: z.object({ nodes: z.array(nodeSchema), diagnostics: z.array(diagnosticSchema) }) })) }).parse(JSON.parse(await fs.readFile(this.cache, 'utf8')));
        if (saved.config === config) { this.entries = saved.entries as Record<string, Entry>; this.config = config; }
      } catch { /* A derived index can be rebuilt from its originals. */ }
    }
    const next: Record<string, Entry> = {}, seen = new Map<string, string>(), diagnostics: ReadResult[] = [];
    let changed = !this.graph || config !== this.config;
    for (const root of roots) {
      const report = (code: string, message: string, file: string) => diagnostics.push({ nodes: [], diagnostics: [{ code, message, rootId: root.id, path: file, scope: root.scope }] });
      const walk = async (file: string): Promise<void> => {
        const stat = await fs.lstat(file);
        if (stat.isSymbolicLink()) return;
        if (stat.isDirectory()) {
          for (const entry of (await fs.readdir(file)).sort()) if (!ignored.has(entry)) await walk(path.join(file, entry));
          return;
        }
        if (!stat.isFile()) return;
        const ext = path.extname(file).toLowerCase(), markdown = ['.md', '.markdown'].includes(ext);
        if ((root.role === 'knowledge') !== markdown) return;
        const reader = readers.find(r => r.extensions.includes(ext)); if (!reader) return;
        const canonical = await fs.realpath(file);
        if (seen.has(canonical)) {
          if (seen.get(canonical) !== root.id) report('overlapping-root', 'File is already registered under root ' + seen.get(canonical), path.relative(root.path, file));
          return;
        }
        seen.set(canonical, root.id);
        const key = root.id + ':' + canonical, stamp = JSON.stringify([stat.mtimeMs, stat.ctimeMs, stat.size, root.scope, reader.id]);
        if (this.entries[key]?.stamp === stamp && this.config === config) next[key] = this.entries[key];
        else {
          const text = await fs.readFile(file, 'utf8');
          next[key] = { stamp, result: reader.read({ rootId: root.id, path: path.relative(root.path, file).replaceAll('\\', '/'), text, scope: root.scope }) };
          changed = true;
        }
      };
      for (const include of root.include) try {
        if (root.optional) { try { await fs.stat(root.path); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') continue; throw e; } }
        await walk(await containedPath(root.path, include));
      } catch (e) {
        if (root.optional && (e as NodeJS.ErrnoException).code === 'ENOENT') continue;
        report('source-read', String(e), include);
      }
    }
    if (Object.keys(next).length !== Object.keys(this.entries).length) changed = true;
    const readDiagnostics = diagnostics.flatMap(r => r.diagnostics);
    if (JSON.stringify(readDiagnostics) !== JSON.stringify(this.graph?.diagnostics.filter(d => ['source-read', 'overlapping-root'].includes(d.code)) ?? [])) changed = true;
    this.entries = next; this.config = config;
    if (changed) {
      this.graph = new KnowledgeGraph([...Object.values(next).map(e => e.result), ...diagnostics]);
      // Compile inherited semantics and text once per changed index, including scope isolation.
      for (const scope of new Set(['shared', ...this.graph.nodes.values()].map(n => typeof n === 'string' ? n : n.scope))) {
        const project = scope === 'shared' ? undefined : scope;
        this.graph.problems(project); this.graph.searchDocuments(project);
      }
      if (this.cache && !this.closed && await fs.stat(path.dirname(path.dirname(this.cache))).then(() => true, () => false)) {
        const before = await textOrNull(this.cache), text = JSON.stringify({ format: 4, config, entries: next });
        try { await atomicWrite(this.cache, text, before === null ? null : hash(before)); }
        catch (e) { if (!/conflict|writer/.test(String(e))) throw e; }
      }
    }
    if (!this.closed && this.watched !== config) {
      for (const w of this.watchers) w.close(); this.watchers = []; this.watched = config;
      for (const dir of new Set(roots.map(r => r.path))) try {
        const watcher = watch(dir, { recursive: true, persistent: false }, (_, name) => {
          const parts = String(name ?? '').split(/[\\/]/);
          if (parts.some(p => ignored.has(p)) && !String(name).replaceAll('\\', '/').startsWith('.logos/tasks/')) return;
          clearTimeout(this.pending);
          this.pending = setTimeout(() => { if (!this.closed) void this.sync(roots, readers).catch(() => {}); }, 40);
          this.pending.unref();
        });
        watcher.unref();
        watcher.on('error', () => { watcher.close(); }); this.watchers.push(watcher);
      } catch { /* Synchronization also checks file metadata on access and at CLI startup. */ }
    }
    return this.graph!;
  }
}
// @logos-id load-graph
