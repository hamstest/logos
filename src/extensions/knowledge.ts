import path from 'node:path';
import { z } from 'zod';
import { stringify } from 'yaml';
import { configuration, sourceRoots } from '../config.js';
import type { Host, Extension, CallContext } from '../host/host.js';
import { atomicWrite, containedPath, textOrNull } from '../host/files.js';
import { removeFragment, restoreFragment, trashList } from '../host/trash.js';
import { loadGraph } from '../knowledge/load.js';
import { KnowledgeGraph } from '../knowledge/graph.js';
import { readMarkdown, markdownReader } from '../knowledge/markdown.js';
import { typescriptReader } from '../knowledge/typescript.js';
import { annotation, hash, type KnowledgeNode } from '../knowledge/model.js';
const output = z.unknown();
const idInput = z.object({ id: z.string() });
const page = { limit: z.number().int().min(1).max(100).default(20), offset: z.number().int().min(0).default(0) };
export async function graphFor(host: Host) {
  const graph = await loadGraph(await sourceRoots(host.workspace, await configuration(host.workspace)), host.readers);
  const extra = (await Promise.all(host.sources.map(get => get()))).flat().flatMap(source => {
    const reader = host.readers.find(r => r.extensions.includes(path.extname(source.path)));
    return reader ? [reader.read(source)] : [];
  });
  return new KnowledgeGraph([{ nodes: [...graph.nodes.values()], diagnostics: graph.diagnostics.filter(d => !['unresolved-reference', 'hierarchy-cycle'].includes(d.code)) }, ...extra]);
}
const brief = (n: KnowledgeNode, host: Host) => ({ id: n.id, kind: n.kind, title: n.title, scope: n.scope, summary: n.content.slice(0, 500), origin: n.origin, operations: host.describe().operations.filter(op => op.implementationId === n.id).map(op => op.name) });
export const knowledge: Extension = {
  id: 'knowledge', description: 'Read annotated originals, select relevant knowledge, and preserve managed edits.',
  setup(host) {
    host.addReader(markdownReader); host.addReader(typescriptReader);
    host.register({ name: 'knowledge.get', description: 'Read full original content, origin, links and available operations by stable ID.', input: idInput, output, async handler({ id }, ctx) {
      const graph = await graphFor(host), node = graph.get(id, ctx.project);
      if (!node) {
        const deleted = (await trashList(host.workspace)).filter(r => r.state !== 'restored' && r.ids.includes(id));
        return { id, status: deleted.length ? 'deleted' : 'unavailable', trashIds: deleted.map(r => r.id) };
      }
      return { ...node, status: 'available', operations: host.describe().operations.filter(op => op.implementationId === id), relations: graph.related(id, ctx.project) };
    }});
    host.register({ name: 'knowledge.search', description: 'Search scoped names and text; use context for inherited criteria.', input: z.object({ query: z.string(), ...page }), output, async handler(input, ctx) {
      const graph = await graphFor(host), matches = graph.search(input.query, ctx.project);
      return { items: matches.slice(input.offset, input.offset + input.limit).map(({ node, score }) => ({ ...brief(node, host), score })), total: matches.length, diagnostics: graph.problems(ctx.project) };
    }});
    host.register({ name: 'knowledge.related', description: 'Traverse incoming and outgoing relations.', input: idInput.extend({ direction: z.enum(['in', 'out', 'both']).default('both'), relation: z.string().optional() }), output, async handler(i, ctx) { return (await graphFor(host)).related(i.id, ctx.project, i.direction, i.relation); }});
    host.register({ name: 'knowledge.context', description: 'Collect criteria through all concept parents, then references; return reasons and pagination.', implementationId: 'implementation/knowledge-graph', input: z.object({ query: z.string().default(''), concepts: z.array(z.string()).default([]), situation: z.record(z.string(), z.unknown()).default({}), ...page }), output, async handler(i, ctx) {
      const result = (await graphFor(host)).context({ ...i, project: ctx.project });
      const judgments = [];
      for (const name of (await configuration(host.workspace)).contextFilters) {
        if (name === 'knowledge.context') throw new Error('A context filter cannot call itself');
        judgments.push({ operation: name, result: await host.call(name, { query: i.query, concepts: result.concepts, situation: i.situation, candidates: result.items.map(x => x.node.id) }, ctx) });
      }
      return { ...result, items: result.items.map(x => ({ ...brief(x.node, host), category: x.category, reasons: x.reasons })), judgments, conditionStatus: 'Natural-language conditions require agent judgment; applies_to indicates structural relevance.' };
    }});
    host.register({ name: 'knowledge.diagnostics', description: 'Read source, annotation and graph problems in the selected scope.', input: z.object({}), output, async handler(_, ctx) { return (await graphFor(host)).problems(ctx.project); }});
    host.register({ name: 'knowledge.create', description: 'Create a new annotated Markdown file in a registered source root.', input: z.object({ rootId: z.string(), path: z.string(), annotation: z.record(z.string(), z.unknown()), body: z.string().min(1) }), output, async handler(i, ctx) {
      const data = annotation(stringify(i.annotation));
      const roots = await sourceRoots(host.workspace, await configuration(host.workspace));
      const root = roots.find(r => r.id === i.rootId); if (!root) throw new Error('Unknown root');
      if (root.scope !== 'shared' && root.scope !== ctx.project) throw new Error('Select the target project first');
      if ((data.scope ?? root.scope) !== root.scope) throw new Error('Annotation scope must match the creation root');
      if (!/\.md$/i.test(i.path)) throw new Error('Managed knowledge creation requires Markdown');
      const included = root.include.some(p => { const rel = path.relative(path.resolve(root.path, p), path.resolve(root.path, i.path)); return !rel.startsWith('..') && !path.isAbsolute(rel); });
      if (!included) throw new Error('Path is outside the configured read range');
      const graph = await graphFor(host); if (graph.nodes.has(data.id) || graph.diagnostics.some(d => d.nodeId === data.id && d.code === 'duplicate-id')) throw new Error('ID is already in use');
      const text = '```logos\n' + stringify(data) + '```\n' + i.body.trim() + '\n';
      const result = readMarkdown({ rootId: root.id, path: i.path, text, scope: root.scope });
      if (result.diagnostics.length || result.nodes.length !== 1) throw new Error('New body must define exactly one valid annotated section or file');
      await atomicWrite(await containedPath(root.path, i.path), text, null);
      return { id: data.id, hash: hash(text) };
    }});
    async function editable(id: string, ctx: CallContext) {
      const graph = await graphFor(host), node = graph.get(id, ctx.project);
      if (!node || node.origin.language !== 'markdown') throw new Error('Only available Markdown originals can be edited with this operation');
      const root = (await sourceRoots(host.workspace, await configuration(host.workspace))).find(r => r.id === node.origin.rootId);
      if (!root) throw new Error('Generated records must be changed through their own operations');
      const file = await containedPath(root.path, node.origin.path); const text = await textOrNull(file);
      if (text === null || hash(text) !== node.origin.hash) throw new Error('Original changed; reread');
      return { graph, node, root, file, text };
    }
    host.register({ name: 'knowledge.update', description: 'Replace an annotated section body; preserve its marker and all existing child IDs. Read origin.hash first.', input: idInput.extend({ expectedHash: z.string(), body: z.string() }), output, async handler(i, ctx) {
      const { node, root, file, text } = await editable(i.id, ctx);
      if (i.expectedHash !== node.origin.hash) throw new Error('Edit conflict: stale hash');
      if (node.origin.targetKind === 'file') throw new Error('File annotations require an ordinary file edit; section update preserves heading attachments');
      const span = node.origin.content, next = text.slice(0, span.start) + i.body.trimEnd() + '\n\n' + text.slice(span.end);
      const source = { rootId: root.id, path: node.origin.path, scope: root.scope };
      const before = readMarkdown({ ...source, text }), after = readMarkdown({ ...source, text: next });
      if (after.diagnostics.length || before.nodes.some(n => !after.nodes.some(a => a.id === n.id))) throw new Error('Update would lose or invalidate an annotation; use explicit deletion or edit a smaller section');
      if (new Set(after.nodes.map(n => n.id)).size !== after.nodes.length || after.nodes.length !== before.nodes.length) throw new Error('Use knowledge.create for new IDs');
      await atomicWrite(file, next, i.expectedHash); return { id: i.id, hash: hash(next) };
    }});
    host.register({ name: 'knowledge.deletePreview', description: 'Show the exact Markdown deletion range and all included child IDs.', input: idInput, output, async handler(i, ctx) {
      const { graph, node } = await editable(i.id, ctx); const span = node.origin.edit;
      return { id: i.id, expectedHash: node.origin.hash, origin: node.origin, affectedIds: [...graph.nodes.values()].filter(n => n.origin.rootId === node.origin.rootId && n.origin.path === node.origin.path && n.origin.annotation.start >= span.start && n.origin.annotation.end <= span.end).map(n => n.id) };
    }});
    host.register({ name: 'knowledge.delete', description: 'Save the original section (including children) in trash, then remove it without cascading to links.', input: idInput.extend({ expectedHash: z.string() }), output, async handler(i, ctx) {
      const { node, root } = await editable(i.id, ctx); const preview = await host.call('knowledge.deletePreview', { id: i.id }, ctx);
      return removeFragment(host.workspace, root.path, node.origin.path, node.origin.edit.start, node.origin.edit.end, i.expectedHash, preview.affectedIds);
    }});
    host.register({ name: 'trash.list', description: 'List recoverable records; originals are never automatically purged.', input: z.object({}), output, async handler() { return (await trashList(host.workspace)).map(({ fragment, ...record }) => ({ ...record, characters: fragment.length })); }});
    host.register({ name: 'trash.restore', description: 'Restore a saved original only when surrounding content and IDs do not conflict.', input: z.object({ trashId: z.string().uuid() }), output, async handler(i) {
      const graph = await graphFor(host); return restoreFragment(host.workspace, i.trashId, [...graph.nodes.keys(), ...graph.diagnostics.flatMap(d => d.code === 'duplicate-id' && d.nodeId ? [d.nodeId] : [])]);
    }});
  },
};
