import { type Diagnostic, type KnowledgeNode, type ReadResult, referenceEdges } from './model.js';
import { canonical, resolveInheritance, type EffectiveDefinition } from './inheritance.js';
import { normalize, tokenize, rankDocuments, type SearchChannel, type SearchHit } from './search.js';

export interface Edge { source: string; relation: string; target: string; position?: number; statement?: import('./model.js').Statement }
export const visible = (scope: string, project?: string) => scope === 'shared' || scope === project;
export interface DiscoveryInput { query?: string; terms?: string[]; targets?: string[]; project?: string; limit?: number; offset?: number; hits?: SearchHit[] }
export interface Evidence { via: string; channels: string[]; path: Edge[]; matchedTerms: string[] }
export interface ContextInput extends DiscoveryInput {
  concepts?: string[]; depth?: number; maxRelated?: number;
  relations?: { relation: string; direction: 'in' | 'out' | 'both' }[];
}

export class KnowledgeGraph {
  readonly nodes = new Map<string, KnowledgeNode>();
  readonly diagnostics: Diagnostic[];
  readonly edges: Edge[] = [];
  private searchCache = new Map<string, ReturnType<KnowledgeGraph["buildSearchDocuments"]>>();
  private effectiveCache = new Map<string, EffectiveDefinition>();
  constructor(results: ReadResult[]) {
    this.diagnostics = results.flatMap(r => r.diagnostics);
    const grouped = new Map<string, KnowledgeNode[]>();
    for (const n of results.flatMap(r => r.nodes)) grouped.set(n.id, [...(grouped.get(n.id) ?? []), n]);
    for (const [id, group] of grouped) {
      if (group.length > 1) {
        for (const n of group) this.diagnostics.push({ code: 'duplicate-id', message: 'Duplicate ID: ' + id, nodeId: id, scope: n.scope, rootId: n.origin.rootId, path: n.origin.path, line: n.origin.line });
      } else this.nodes.set(id, group[0]);
    }
    for (const n of this.nodes.values()) for (const l of referenceEdges(n.statements)) {
      this.edges.push({ source: n.id, ...l });
      if (!this.nodes.has(l.target)) this.diagnostics.push({ code: 'unresolved-reference', message: 'Unresolved target: ' + l.target, nodeId: n.id, scope: n.scope, rootId: n.origin.rootId, path: n.origin.path, line: n.origin.line });
    }
  }
  get(id: string, project?: string) {
    const n = this.nodes.get(id);
    return n && visible(n.scope, project) ? n : undefined;
  }
  list(project?: string) { return [...this.nodes.values()].filter(n => visible(n.scope, project)).sort((a, b) => a.id.localeCompare(b.id)); }
  effective(id: string, project?: string) {
    const key = canonical([project ?? null, id]);
    if (!this.effectiveCache.has(key)) this.effectiveCache.set(key, resolveInheritance(id, key => this.get(key, project)));
    return this.effectiveCache.get(key)!;
  }
  problems(project?: string) {
    return [...this.diagnostics.filter(d => !d.scope || visible(d.scope, project)), ...this.list(project).flatMap(n => this.effective(n.id, project).diagnostics)];
  }
  related(id: string, project?: string, direction: 'in' | 'out' | 'both' = 'both', relation?: string, mode: 'effective' | 'asserted' = 'effective') {
    if (!this.get(id, project)) throw new Error('Node is unavailable in this scope: ' + id);
    const edges = mode === 'asserted'
      ? this.edges.filter(e => this.get(e.source, project)).map(e => ({ ...e, origins: [{ nodeId: e.source, path: [e.source] }] }))
      : this.list(project).flatMap(n => referenceEdges(this.effective(n.id, project).statements).map(l => ({ source: n.id, ...l, origins: l.origins! })));
    return edges.filter(e => (!relation || e.relation === relation) &&
      ((direction !== 'in' && e.source === id) || (direction !== 'out' && e.target === id)))
      .map(e => ({ ...e, targetStatus: !this.nodes.has(e.target) ? 'unresolved' as const : this.get(e.target, project) ? 'available' as const : 'out-of-scope' as const }))
      .filter(e => e.source === id || e.targetStatus === 'available');
  }
  searchDocuments(project?: string) {
    const key = project ?? "";
    if (!this.searchCache.has(key)) this.searchCache.set(key, this.buildSearchDocuments(project));
    return this.searchCache.get(key)!;
  }
  private buildSearchDocuments(project?: string) {
    return this.list(project).filter(n => n.origin.language === 'markdown').map(node => {
      const definition = this.effective(node.id, project);
      const text = definition.definitions.map(d => d.content).join('\n') + '\n' + canonical(definition.statements.map(s => ({predicate:s.predicate, arguments:s.arguments})));
      return { node: {...node, aliases: [...new Set(definition.statements.filter(s => s.predicate === 'alias').flatMap(s => s.arguments.filter((a): a is string => typeof a === 'string')))]}, text, tokens: tokenize(text) };
    });
  }
  search(query: string, project?: string, terms: string[] = [], channels: SearchChannel[] = []) {
    return rankDocuments(this.searchDocuments(project), query, terms, channels);
  }
  discover(input: DiscoveryInput) {
    const { project } = input, query = input.query ?? '', terms = input.terms ?? [];
    const hits = input.hits ?? this.search(query, project, terms);
    const references = hits.slice(0, 40).map(h => ({ ...h }));
    const diagnostics: Diagnostic[] = [];
    for (const id of input.targets ?? []) {
      const node = this.get(id, project);
      if (!node) diagnostics.push({ code: 'unknown-target', message: 'Target unavailable: ' + id });
      else if (!references.some(r => r.node.id === id)) references.unshift({ node, score: 1, channels: ['target'], matchedTerms: [] });
    }
    const candidates = new Map<string, { node: KnowledgeNode; score: number; evidence: Evidence[] }>();
    const add = (node: KnowledgeNode, hit: SearchHit, path: Edge[]) => {
      if (node.origin.language !== 'markdown') return;
      const item = candidates.get(node.id) ?? { node, score: 0, evidence: [] };
      const evidence = { via: hit.node.id, channels: hit.channels, path, matchedTerms: hit.matchedTerms };
      if (!item.evidence.some(e => canonical(e) === canonical(evidence))) {
        item.evidence.push(evidence); item.score = Math.max(item.score, hit.score / (1 + path.length));
      }
      candidates.set(node.id, item);
    };
    for (const hit of references) {
      const topics = this.related(hit.node.id, project, 'out', 'about');
      const subjects = this.related(hit.node.id, project, 'in', 'governed-by');
      if (!topics.length && !subjects.length) add(hit.node, hit, []);
      for (const edge of topics) {
        const node = this.get(edge.target, project); if (node) add(node, hit, [edge]);
      }
      for (const edge of subjects) {
        const node = this.get(edge.source, project); if (node) add(node, hit, [edge]);
      }
      if (!['markdown', 'json'].includes(hit.node.origin.language)) {
        for (const edge of this.related(hit.node.id, project, 'in').filter(e => ['implemented-by', 'verified-by'].includes(e.relation))) {
          const document = this.get(edge.source, project);
          if (document?.origin.language !== 'markdown') continue;
          const topics = this.related(document.id, project, 'out', 'about');
          const subjects = this.related(document.id, project, 'in', 'governed-by');
          if (!topics.length && !subjects.length) add(document, hit, [edge]);
          for (const next of topics) { const node = this.get(next.target, project); if (node) add(node, hit, [edge, next]); }
          for (const next of subjects) { const node = this.get(next.source, project); if (node) add(node, hit, [edge, next]); }
        }
      }
    }
    const named = new Map<string, Set<string>>();
    for (const { node: n } of this.searchDocuments(project)) for (const label of [n.title, ...n.aliases]) {
      const name = normalize(label);
      if (name && [query, ...terms].some(q => normalize(q).includes(name))) named.set(name, new Set([...(named.get(name) ?? []), n.id]));
    }
    const all = [...candidates.values()].sort((a, b) => b.score - a.score || a.node.id.localeCompare(b.node.id));
    const limit = input.limit ?? 20, offset = input.offset ?? 0;
    return { query, terms, candidates: all.slice(offset, offset + limit), total: all.length,
      nextOffset: offset + limit < all.length ? offset + limit : null, references,
      ambiguities: [...named].filter(([, ids]) => ids.size > 1).map(([name, ids]) => ({ name, candidates: [...ids].sort() })),
      unresolved: all.length ? [] : [query, ...terms].filter(Boolean), diagnostics,
      truncated: hits.length > 40, referenceTotal: hits.length };
  }
  context(input: ContextInput) {
    const { project } = input;
    const problems = this.problems(project);
    const discovery = this.discover({ ...input, limit: Number.MAX_SAFE_INTEGER, offset: 0 });
    const selectedIds = [...new Set([...(input.concepts ?? []), ...discovery.candidates.map(c => c.node.id)])];
    const paths = new Map<string, string[]>();
    for (const id of selectedIds) {
      if (!this.get(id, project)) { problems.push({ code: 'unknown-concept', message: 'Concept unavailable: ' + id }); continue; }
      for (const entry of this.effective(id, project).lineage) if (!paths.has(entry.id)) paths.set(entry.id, entry.path);
    }
    problems.push(...discovery.diagnostics);
    const selected = new Map<string, { node: KnowledgeNode; reasons: string[]; category: 'applicable' | 'concept' | 'reference' }>();
    for (const id of paths.keys()) for (const l of referenceEdges(this.effective(id, project).statements).map(l => ({...l, origins:l.origins!})).filter(l => l.relation === 'governed-by')) {
      const node = this.get(l.target, project);
      if (node) selected.set(node.id, { node, category: 'applicable', reasons: ['governed by ' + id + ' (declared by ' + l.origins.map(o => o.nodeId).join(', ') + ')'] });
    }
    for (const n of this.list(project)) {
      const matches = referenceEdges(this.effective(n.id, project).statements).filter(l => l.relation === 'about' && paths.has(l.target));
      if (matches.length) selected.set(n.id, { node: n, category: 'applicable', reasons: matches.map(l => 'about: ' + paths.get(l.target)!.join(' -> ')) });
    }
    for (const id of paths.keys()) if (!selected.has(id)) selected.set(id, { node: this.get(id, project)!, category: 'concept', reasons: ['selected concept or inherited definition'] });
    for (const hit of discovery.references.slice(0, 20)) if (!selected.has(hit.node.id)) selected.set(hit.node.id, { node: hit.node, category: 'reference', reasons: hit.channels.map(c => 'search: ' + c) });
    for (const id of input.targets ?? []) {
      const node = this.get(id, project);
      if (node && !selected.has(id)) selected.set(id, { node, category: 'reference', reasons: ['explicit target'] });
    }
    let frontier = [...selected.keys()], count = 0, truncated = false;
    const visited = new Set(frontier), max = input.maxRelated ?? 25;
    for (let depth = 0; depth < (input.depth ?? 1); depth++) {
      const next: string[] = [];
      for (const id of frontier) {
        const edges = input.relations?.length
          ? input.relations.flatMap(r => this.related(id, project, r.direction, r.relation))
          : this.related(id, project);
        for (const edge of edges) {
          const other = edge.source === id ? edge.target : edge.source;
          const node = this.get(other, project);
          if (!node || visited.has(other)) continue;
          if (count >= max) { truncated = true; continue; }
          visited.add(other); next.push(other); count++;
          if (!selected.has(other)) selected.set(other, { node, category: 'reference', reasons: [edge.source + ' --' + edge.relation + '--> ' + edge.target] });
        }
      }
      frontier = next;
    }
    const rank = { applicable: 0, concept: 1, reference: 2 };
    const all = [...selected.values()].sort((a, b) => rank[a.category] - rank[b.category] || a.node.id.localeCompare(b.node.id));
    const offset = input.offset ?? 0, limit = input.limit ?? 20;
    const grounded = selectedIds.filter(id => !!this.get(id, project));
    const ambiguities = discovery.ambiguities;
    return { query: input.query ?? '', items: all.slice(offset, offset + limit), total: all.length,
      nextOffset: offset + limit < all.length ? offset + limit : null,
      concepts: [...paths.keys()], conceptPaths: Object.fromEntries(paths), ambiguities,
      grounding: { provided: input.concepts ?? [], retrieved: discovery.candidates.map(c => c.node.id), unresolved: discovery.unresolved },
      diagnostics: problems, truncated: truncated || discovery.truncated, incomplete: discovery.truncated || problems.length > 0 || ambiguities.length > 0 || truncated || (grounded.length === 0 && discovery.unresolved.length > 0),
      discovery };
  }
}
// @logos-id knowledge-graph
