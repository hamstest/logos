import type { Diagnostic, KnowledgeNode, ReadResult } from './model.js';

export interface Edge { source: string; relation: string; target: string }
export const visible = (scope: string, project?: string) => scope === 'shared' || scope === project;

/* @logos
format: 1
id: implementation/knowledge-graph
kind: implementation
links:
  - relation: implements
    target: criterion/semantic-context
*/
export class KnowledgeGraph {
  readonly nodes = new Map<string, KnowledgeNode>();
  readonly diagnostics: Diagnostic[];
  readonly edges: Edge[] = [];
  constructor(results: ReadResult[]) {
    this.diagnostics = results.flatMap(r => r.diagnostics);
    const grouped = new Map<string, KnowledgeNode[]>();
    for (const n of results.flatMap(r => r.nodes)) grouped.set(n.id, [...(grouped.get(n.id) ?? []), n]);
    for (const [id, group] of grouped) {
      if (group.length > 1) {
        for (const n of group) this.diagnostics.push({ code: 'duplicate-id', message: `Duplicate ID: ${id}`, nodeId: id, scope: n.scope, rootId: n.origin.rootId, path: n.origin.path, line: n.origin.line });
      } else this.nodes.set(id, group[0]);
    }
    for (const n of this.nodes.values()) for (const l of n.links) {
      this.edges.push({ source: n.id, ...l });
      if (!this.nodes.has(l.target)) this.diagnostics.push({ code: 'unresolved-reference', message: `Unresolved target: ${l.target}`, nodeId: n.id, scope: n.scope, rootId: n.origin.rootId, path: n.origin.path, line: n.origin.line });
    }
    const finished = new Set<string>();
    const active = new Set<string>();
    const visit = (id: string): void => {
      if (active.has(id)) {
        const n = this.nodes.get(id)!;
        this.diagnostics.push({ code: 'hierarchy-cycle', message: `Cyclic is_a relation at ${id}`, nodeId: id, scope: n.scope });
        return;
      }
      if (finished.has(id)) return;
      active.add(id);
      for (const l of this.nodes.get(id)?.links ?? []) if (l.relation === 'is_a' && this.nodes.has(l.target)) visit(l.target);
      active.delete(id); finished.add(id);
    };
    for (const id of this.nodes.keys()) visit(id);
  }
  get(id: string, project?: string) {
    const n = this.nodes.get(id);
    return n && visible(n.scope, project) ? n : undefined;
  }
  problems(project?: string) { return this.diagnostics.filter(d => !d.scope || visible(d.scope, project)); }
  list(project?: string) { return [...this.nodes.values()].filter(n => visible(n.scope, project)).sort((a, b) => a.id.localeCompare(b.id)); }
  related(id: string, project?: string, direction: 'in' | 'out' | 'both' = 'both', relation?: string) {
    if (!this.get(id, project)) throw new Error(`Node is unavailable in this scope: ${id}`);
    return this.edges.filter(e => (!relation || e.relation === relation) &&
      ((direction !== 'in' && e.source === id) || (direction !== 'out' && e.target === id)))
      .filter(e => e.source === id || this.get(e.source, project))
      .map(e => ({ ...e, targetStatus: !this.nodes.has(e.target) ? 'unresolved' : this.get(e.target, project) ? 'available' : 'out-of-scope' }))
      .filter(e => e.source === id || e.targetStatus === 'available');
  }
  search(query: string, project?: string) {
    const words = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
    return this.list(project).map(node => {
      const label = [node.id, node.title, ...node.aliases].join(' ').toLocaleLowerCase();
      const body = node.content.toLocaleLowerCase();
      const score = words.reduce((n, w) => n + (label.includes(w) ? 5 : body.includes(w) ? 1 : 0), 0);
      return { node, score };
    }).filter(x => x.score > 0).sort((a, b) => b.score - a.score || a.node.id.localeCompare(b.node.id));
  }
  context(input: { query?: string; concepts?: string[]; project?: string; limit?: number; offset?: number }) {
    const { project } = input;
    const problems = this.problems(project);
    const seeds = new Set<string>();
    const ambiguities: { name: string; candidates: string[] }[] = [];
    for (const id of input.concepts ?? []) {
      if (this.get(id, project)) seeds.add(id);
      else problems.push({ code: 'unknown-concept', message: `Concept unavailable: ${id}` });
    }
    const query = (input.query ?? '').toLocaleLowerCase();
    const named = new Map<string, string[]>();
    if (query) for (const n of this.list(project).filter(n => n.kind === 'concept')) {
      for (const name of [n.title, ...n.aliases]) if (name && query.includes(name.toLocaleLowerCase())) {
        const key = name.toLocaleLowerCase(); named.set(key, [...new Set([...(named.get(key) ?? []), n.id])]);
      }
    }
    for (const [name, candidates] of named) {
      if (candidates.length === 1) seeds.add(candidates[0]);
      else ambiguities.push({ name, candidates });
    }
    const paths = new Map<string, string[]>();
    const queue = [...seeds].map(id => [id]);
    while (queue.length) {
      const route = queue.shift()!;
      const id = route.at(-1)!;
      if (paths.has(id)) continue;
      const node = this.get(id, project);
      if (!node) continue;
      paths.set(id, route);
      for (const l of node.links) if (l.relation === 'is_a' || l.relation === 'instance_of') queue.push([...route, l.target]);
    }
    const selected = new Map<string, { node: KnowledgeNode; reasons: string[]; category: 'applicable' | 'concept' | 'reference' }>();
    for (const n of this.list(project)) {
      const matches = n.links.filter(l => l.relation === 'applies_to' && paths.has(l.target));
      if (matches.length) selected.set(n.id, { node: n, category: 'applicable', reasons: matches.map(l => `applies_to: ${paths.get(l.target)!.join(' -> ')}`) });
    }
    for (const id of paths.keys()) if (!selected.has(id)) selected.set(id, { node: this.get(id, project)!, category: 'concept', reasons: ['classification'] });
    for (const { node } of this.search(input.query ?? '', project).slice(0, 20)) if (!selected.has(node.id)) selected.set(node.id, { node, category: 'reference', reasons: ['text-match'] });
    let count = 0;
    for (const id of [...selected.keys()]) {
      for (const edge of this.related(id, project)) {
        const other = edge.source === id ? edge.target : edge.source;
        const node = this.get(other, project);
        if (!node || selected.has(other) || count >= 25) continue;
        selected.set(other, { node, category: 'reference', reasons: [`${edge.source} --${edge.relation}--> ${edge.target}`] });
        count++;
      }
    }
    const rank = { applicable: 0, concept: 1, reference: 2 };
    const all = [...selected.values()].sort((a, b) => rank[a.category] - rank[b.category] || a.node.id.localeCompare(b.node.id));
    const offset = input.offset ?? 0, limit = input.limit ?? 20;
    return { items: all.slice(offset, offset + limit), total: all.length,
      nextOffset: offset + limit < all.length ? offset + limit : null,
      concepts: [...paths.keys()], conceptPaths: Object.fromEntries(paths), ambiguities,
      diagnostics: problems, incomplete: problems.length > 0 || ambiguities.length > 0 };
  }
}
