import { readTask, saveTask } from '../tasks/store.js';
import { changeSchema, effectiveSchema, discoverySchema, searchHitSchema, contextSchema, diagnosticSchema, edgeSchema, nodeSchema, operationDescriptionSchema, originSchema } from '../knowledge/contracts.js';
import path from 'node:path';
import { z } from 'zod';
import { configuration, sourceRoots } from '../config.js';
import type { Host, Extension, CallContext } from '../host/host.js';
import { atomicWrite, containedPath, textOrNull } from '../host/files.js';
import { graphFor } from '../knowledge/service.js';
import { KnowledgeGraph } from '../knowledge/graph.js';
import { readMarkdown, markdownReader, insertDefinition } from '../knowledge/markdown.js';
import { typescriptReader } from '../knowledge/typescript.js';
import { idSchema, parseDefinition, hash, type KnowledgeNode } from '../knowledge/model.js';

const idInput = z.object({ id: idSchema });
const page = { limit: z.number().int().min(1).max(100).default(20), offset: z.number().int().min(0).default(0) };

async function searchFor(host: Host, graph: KnowledgeGraph, query: string, terms: string[], ctx: CallContext) {
  const documents = host.searchProviders.length ? graph.searchDocuments(ctx.project) : [];
  const channels: import('../knowledge/search.js').SearchChannel[] = [];
  const diagnostics: import('../knowledge/model.js').Diagnostic[] = [];
  if (query.trim() || terms.length) await Promise.all(host.searchProviders.map(async provider => {
    try {
      const results = z.array(z.object({ id: idSchema, score: z.number().finite() })).parse(await provider.search({
        query, terms, project: ctx.project,
        documents: documents.map(d => ({ id: d.node.id, title: d.node.title, text: d.text })),
      }));
      channels.push({ name: provider.id, results });
    } catch {
      diagnostics.push({ code: 'search-provider-unavailable', message: 'Search provider unavailable: ' + provider.id + '; lexical retrieval remains available.' });
    }
  }));
  channels.sort((a, b) => a.name.localeCompare(b.name));
  return { hits: graph.search(query, ctx.project, terms, channels), diagnostics };
}

const brief = (n: KnowledgeNode, host: Host) => ({ id: n.id, title: n.title, scope: n.scope, summary: n.content.slice(0, 500), origin: n.origin, operations: host.describe().operations.filter(op => op.implementationId === n.id).map(op => op.name) });
export const knowledge: Extension = {
  implementationId: 'knowledge-extension',
  id: 'knowledge', description: 'Read annotated originals, select relevant knowledge, and preserve managed edits.',
  setup(host) {
    host.addReader(markdownReader); host.addReader(typescriptReader);
    host.register({ name: 'knowledge.get', description: 'Read original content, statements, origin and available operations by stable ID.', input: idInput, output: z.union([nodeSchema.extend({ status: z.literal('available'), operations: z.array(operationDescriptionSchema), relations: z.array(edgeSchema), effective: effectiveSchema }), z.object({ id: idSchema, status: z.literal('unavailable') })]), async handler({ id }, ctx) {
      const graph = await graphFor(host), node = graph.get(id, ctx.project);
      if (!node) return { id, status: 'unavailable' };
      return { ...node, effective: graph.effective(id, ctx.project), status: 'available', operations: host.describe().operations.filter(op => op.implementationId === id), relations: graph.related(id, ctx.project) };
    }});
    host.register({ name: 'knowledge.search', description: 'Search scoped Japanese text, names and inherited definitions; returns candidates, never classifications.', input: z.object({ query: z.string(), terms: z.array(z.string()).default([]), ...page }), output: z.object({ items: z.array(searchHitSchema), total: z.number(), nextOffset: z.number().int().nullable(), diagnostics: z.array(diagnosticSchema) }), async handler(input, ctx) {
      const graph = await graphFor(host), result = await searchFor(host, graph, input.query, input.terms, ctx);
      const end = input.offset + input.limit;
      return { items: result.hits.slice(input.offset, end).map(({ node, ...hit }) => ({ ...brief(node, host), ...hit })), total: result.hits.length, nextOffset: end < result.hits.length ? end : null, diagnostics: [...graph.problems(ctx.project), ...result.diagnostics] };
    }});
    host.register({ name: 'knowledge.discover', description: 'Inspect optional concept candidates from definitions, Markdown and source targets. knowledge.context merges these with optional caller concepts. Never invent IDs or treat a hit as a fact.', input: z.object({ query: z.string().default(''), terms: z.array(z.string()).default([]), targets: z.array(idSchema).default([]), ...page }).strict(), output: discoverySchema, async handler(input, ctx) {
      const graph = await graphFor(host), search = await searchFor(host, graph, input.query, input.terms, ctx);
      const result = graph.discover({ ...input, project: ctx.project, hits: search.hits });
      return { ...result, candidates: result.candidates.map(({ node, ...item }) => ({ ...brief(node, host), ...item, definition: node.content.slice(0, 1000) })),
        references: result.references.map(({ node, ...item }) => ({ ...brief(node, host), ...item })),
        diagnostics: [...result.diagnostics, ...graph.problems(ctx.project), ...search.diagnostics] };
    }});
    host.register({ name: 'knowledge.related', description: 'Traverse inherited relations by default, with declaring origins. Use mode asserted to inspect only directly declared reference statements.', input: idInput.extend({ direction: z.enum(['in', 'out', 'both']).default('both'), relation: idSchema.optional(), mode: z.enum(['effective', 'asserted']).default('effective') }), output: z.array(edgeSchema), async handler(i, ctx) { return (await graphFor(host)).related(i.id, ctx.project, i.direction, i.relation, i.mode); }});
    host.register({ name: 'knowledge.context', description: 'Use IDs merged from body search and optional caller concepts. Collect complete inherited definitions and applicable knowledge; choose relation directions for bounded traversal.', implementationId: 'knowledge-graph', input: z.object({ query: z.string().default(''), terms: z.array(z.string()).default([]), targets: z.array(idSchema).default([]), concepts: z.array(idSchema).default([]), depth: z.number().int().min(0).max(10).default(1), maxRelated: z.number().int().min(0).max(1000).default(25), relations: z.array(z.object({ relation: idSchema, direction: z.enum(['in', 'out', 'both']) })).optional(), situation: z.record(z.string(), z.unknown()).default({}), ...page }).strict(), output: contextSchema, async handler(i, ctx) {
      if (ctx.taskId) {
        const task = await readTask(host, ctx.taskId, ctx.project);
        ctx = { ...ctx, project: task.project };
        if (!i.query.trim()) i.query = task.objective;
      }
      const graph = await graphFor(host), search = await searchFor(host, graph, i.query, i.terms, ctx);
      const result = graph.context({ ...i, limit: Number.MAX_SAFE_INTEGER, offset: 0, project: ctx.project, hits: search.hits });
      const judgments = [];
      const decisions = new Map<string, { include: boolean; reasons: string[] }>();
      let unknown = false;
      for (const name of (await configuration(host.workspace)).contextFilters) {
        if (name === 'knowledge.context') throw new Error('A context filter cannot call itself');
        const evaluated = z.array(z.object({ id: idSchema, decision: z.enum(['include', 'exclude', 'unknown']), reason: z.string() }).strict()).parse(
          await host.call(name, { query: i.query, concepts: result.concepts, situation: i.situation, candidates: result.items.map(x => x.node.id) }, ctx));
        judgments.push({ operation: name, result: evaluated });
        for (const d of evaluated) {
          if (d.decision === 'unknown') { unknown = true; continue; }
          const previous = decisions.get(d.id);
          decisions.set(d.id, { include: d.decision === 'include' && previous?.include !== false, reasons: [...previous?.reasons ?? [], d.reason] });
        }
      }
      for (const [id, d] of decisions) {
        const at = result.items.findIndex(x => x.node.id === id);
        if (!d.include && at >= 0) result.items.splice(at, 1);
        if (d.include) {
          const node = graph.get(id, ctx.project);
          if (!node) { unknown = true; result.diagnostics.push({ code: 'unknown-selection', message: 'Selection target unavailable: ' + id }); continue; }
          if (at < 0) result.items.push({ node, category: 'applicable', reasons: d.reasons });
          else result.items[at].reasons.push(...d.reasons);
        }
      }
      result.concepts = result.concepts.filter(id => decisions.get(id)?.include !== false);
      for (const [id, decision] of decisions) if (decision.include && graph.get(id, ctx.project) && !result.concepts.includes(id)) result.concepts.push(id);
      const usedConcepts = result.concepts;
      if (ctx.taskId) {
        const task = await readTask(host, ctx.taskId, ctx.project);
        const combined = [...new Set([...task.usedConcepts, ...usedConcepts])];
        if (combined.length !== task.usedConcepts.length) await saveTask(host, { ...task, usedConcepts: combined }, task.revision);
      }
      result.total = result.items.length;
      result.nextOffset = i.offset + i.limit < result.total ? i.offset + i.limit : null;
      result.items = result.items.slice(i.offset, i.offset + i.limit);
      return { ...result, items: result.items.map(x => {
        const effective = graph.effective(x.node.id, ctx.project);
        return { ...brief(x.node, host), category: x.category, reasons: x.reasons, statements: effective.statements, inheritedFrom: effective.lineage.filter(l => l.id !== x.node.id).map(l => l.id) };
      }), diagnostics: [...result.diagnostics, ...search.diagnostics], incomplete: result.incomplete || search.diagnostics.length > 0 || unknown,
      judgments, conditionStatus: 'Merged concepts are request-local retrieval inputs. Similarity does not establish a fact. Inherited declarations all apply; unresolved conflicts and natural-language conditions require inspection.' };
    }});
    host.register({ name: 'knowledge.diagnostics', description: 'Read source, annotation and graph problems in the selected scope.', input: z.object({}), output: z.array(diagnosticSchema), async handler(_, ctx) { return (await graphFor(host)).problems(ctx.project); }});
    host.register({ name: 'knowledge.create', description: 'Create a new annotated Markdown file in a registered source root.', input: z.object({ rootId: idSchema, path: z.string(), definition: z.string().min(1), body: z.string().min(1) }).strict(), output: changeSchema, async handler(i, ctx) {
      const data = parseDefinition(i.definition);
      const roots = await sourceRoots(host.workspace, await configuration(host.workspace));
      const root = roots.find(r => r.id === i.rootId); if (!root) throw new Error('Unknown root');
      if (root.role !== 'knowledge') throw new Error('Save knowledge in Logos using the project knowledge root; source roots are read-only');
      if (root.scope !== 'shared' && root.scope !== ctx.project) throw new Error('Select the target project first');
      if (!/\.md$/i.test(i.path)) throw new Error('Managed knowledge creation requires Markdown');
      const included = root.include.some(p => { const rel = path.relative(path.resolve(root.path, p), path.resolve(root.path, i.path)); return !rel.startsWith('..') && !path.isAbsolute(rel); });
      if (!included) throw new Error('Path is outside the configured read range');
      const graph = await graphFor(host); if (graph.nodes.has(data.id) || graph.diagnostics.some(d => d.nodeId === data.id && d.code === 'duplicate-id')) throw new Error('ID is already in use');
      const text = insertDefinition(i.body, data);
      const result = readMarkdown({ rootId: root.id, path: i.path, text, scope: root.scope });
      if (result.diagnostics.length || result.nodes.length !== 1) throw new Error('New body must define exactly one valid annotated section or file');
      await atomicWrite(await containedPath(root.path, i.path), text, null);
      await graphFor(host);
      return { id: data.id, hash: hash(text) };
    }});
    async function editable(id: string, ctx: CallContext) {
      const graph = await graphFor(host), node = graph.get(id, ctx.project);
      if (!node || node.origin.language !== 'markdown') throw new Error('Only available Markdown originals can be edited with this operation');
      const root = (await sourceRoots(host.workspace, await configuration(host.workspace))).find(r => r.id === node.origin.rootId);
      if (!root) throw new Error('Generated records must be changed through their own operations');
      if (root.role !== 'knowledge') throw new Error('Source roots are read-only');
      if (graph.diagnostics.some(d => d.rootId === node.origin.rootId && d.path === node.origin.path && ['duplicate-id', 'invalid-annotation', 'ambiguous-target'].includes(d.code))) throw new Error('Fix ambiguous or invalid annotations before managed edits');
      const file = await containedPath(root.path, node.origin.path); const text = await textOrNull(file);
      if (text === null || hash(text) !== node.origin.hash) throw new Error('Original changed; reread');
      return { graph, node, root, file, text };
    }
    host.register({ name: 'knowledge.update', description: 'Replace an annotated section body; preserve its marker and all existing child IDs. Read origin.hash first.', input: idInput.extend({ expectedHash: z.string(), body: z.string() }), output: changeSchema, async handler(i, ctx) {
      const { node, root, file, text } = await editable(i.id, ctx);
      if (i.expectedHash !== node.origin.hash) throw new Error('Edit conflict: stale hash');
      const span = node.origin.content, next = text.slice(0, span.start) + insertDefinition(i.body, node) + '\n' + text.slice(span.end);
      const source = { rootId: root.id, path: node.origin.path, scope: root.scope };
      const before = readMarkdown({ ...source, text }), after = readMarkdown({ ...source, text: next });
      if (after.diagnostics.length || before.nodes.some(n => !after.nodes.some(a => a.id === n.id))) throw new Error('Update would lose or invalidate an annotation; use explicit deletion or edit a smaller section');
      if (new Set(after.nodes.map(n => n.id)).size !== after.nodes.length || after.nodes.length !== before.nodes.length) throw new Error('Use knowledge.create for new IDs');
      await atomicWrite(file, next, i.expectedHash); await graphFor(host); return { id: i.id, hash: hash(next) };
    }});
    host.register({ name: 'knowledge.deletePreview', description: 'Show the exact Markdown deletion range and all included child IDs.', input: idInput, output: z.object({ id: idSchema, expectedHash: z.string(), origin: originSchema, affectedIds: z.array(z.string()) }), async handler(i, ctx) {
      const { graph, node } = await editable(i.id, ctx); const span = node.origin.edit;
      return { id: i.id, expectedHash: node.origin.hash, origin: node.origin, affectedIds: [...graph.nodes.values()].filter(n => n.origin.rootId === node.origin.rootId && n.origin.path === node.origin.path && n.origin.annotation.start >= span.start && n.origin.annotation.end <= span.end).map(n => n.id) };
    }});
    host.register({ name: 'knowledge.delete', description: 'Remove the Markdown section and its children without cascading to references. Use Git for versioned history and restoration.', input: idInput.extend({ expectedHash: z.string() }), output: changeSchema.extend({ affectedIds: z.array(idSchema) }), async handler(i, ctx) {
      const { graph, node, file, text } = await editable(i.id, ctx);
      if (i.expectedHash !== node.origin.hash) throw new Error('Edit conflict: stale hash');
      const span = node.origin.edit;
      const affectedIds = [...graph.nodes.values()].filter(n => n.origin.rootId === node.origin.rootId && n.origin.path === node.origin.path && n.origin.annotation.start >= span.start && n.origin.annotation.end <= span.end).map(n => n.id);
      const next = text.slice(0, span.start) + text.slice(span.end);
      await atomicWrite(file, next, i.expectedHash);
      await graphFor(host);
      return { id: i.id, hash: hash(next), affectedIds };
    }});
  },
};
// @logos-id knowledge-extension
