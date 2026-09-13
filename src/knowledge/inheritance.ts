import { isReference, targets, type Diagnostic, type KnowledgeNode, type Statement, type Value } from './model.js';
export interface Provenance { nodeId: string; path: string[] }
export interface InheritedStatement extends Statement { origins: Provenance[] }
export const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => JSON.stringify(k) + ':' + canonical(v)).join(',') + '}';
  return JSON.stringify(value) ?? 'null';
};
export function resolveInheritance(id: string, get: (id: string) => KnowledgeNode | undefined) {
  const root = get(id); if (!root) throw new Error('Definition unavailable: ' + id);
  const paths = new Map<string, string[]>(), inheritance: { source: string; relation: string; target: string }[] = [];
  const diagnostics: Diagnostic[] = [];
  const problem = (code: string, message: string) => diagnostics.push({ code, message, nodeId: id, scope: root.scope });
  const queue = [[id]];
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const route = queue[cursor], current = route.at(-1)!;
    if (paths.has(current)) continue;
    const node = get(current)!; paths.set(current, route);
    for (const parent of [...new Set(targets(node.statements, 'is'))].sort()) {
      inheritance.push({ source: current, relation: 'is', target: parent });
      if (!get(parent)) problem('invalid-parent', 'Parent unavailable: ' + current + ' -> ' + parent);
      else queue.push([...route, parent]);
    }
  }
  const active = new Set<string>(), done = new Set<string>();
  function visit(current: string) {
    if (active.has(current)) { problem('hierarchy-cycle', 'Inheritance cycle reachable from ' + id); return; }
    if (done.has(current)) return;
    active.add(current);
    for (const edge of inheritance.filter(e => e.source === current && paths.has(e.target))) visit(edge.target);
    active.delete(current); done.add(current);
  }
  visit(id);
  const merged = new Map<string, InheritedStatement>();
  const definitions = [...paths].map(([nodeId, route]) => {
    const node = get(nodeId)!;
    for (const s of node.statements) {
      const key = canonical(s), same = merged.get(key), origin = { nodeId, path: route };
      if (same) same.origins.push(origin); else merged.set(key, { ...s, origins: [origin] });
    }
    return { id: nodeId, title: node.title, content: node.content, origin: node.origin, path: route };
  });
  // Collect predicate declarations and type ancestry without recursively validating them.
  const declarations = new Map<string, { ids: Set<string>; statements: Statement[] }>();
  function collect(key: string) {
    if (declarations.has(key)) return declarations.get(key)!;
    const ids = new Set<string>(), statements = new Map<string, Statement>(), queue = [key];
    for (let i = 0; i < queue.length; i++) {
      const current = queue[i]; if (ids.has(current)) continue;
      const node = get(current); if (!node) continue;
      ids.add(current);
      for (const s of node.statements) statements.set(canonical(s), s);
      queue.push(...targets(node.statements, 'is'));
    }
    const result = { ids, statements: [...statements.values()] }; declarations.set(key, result); return result;
  }
  function matches(value: Value, type: Value): boolean {
    if (!isReference(type)) return false;
    if (type.ref === 'string') return typeof value === 'string';
    if (type.ref === 'number') return typeof value === 'number';
    if (type.ref === 'boolean') return typeof value === 'boolean';
    if (!isReference(value) || !get(value.ref)) return false;
    if (type.ref === 'reference') return true;
    if (type.ref === 'source') return !['markdown', 'json'].includes(get(value.ref)!.origin.language);
    return collect(value.ref).ids.has(type.ref);
  }
  const statements = [...merged.values()].sort((a, b) => canonical([a.predicate, a.arguments]).localeCompare(canonical([b.predicate, b.arguments])));
  const conflicts: { predicate: string; values: Value[][] }[] = [];
  for (const predicate of new Set(statements.map(s => s.predicate))) {
    const declaration = collect(predicate), values = statements.filter(s => s.predicate === predicate);
    if (!get(predicate)) problem('unknown-predicate', 'Predicate declaration unavailable: ' + predicate);
    for (const s of values) {
      if (predicate === 'is' && (s.arguments.length !== 1 || !isReference(s.arguments[0]))) problem('invalid-statement', 'is requires exactly one parent reference');
      if (predicate === 'unique' && (s.arguments.length !== 1 || typeof s.arguments[0] !== 'boolean')) problem('invalid-statement', 'unique requires exactly one boolean');
    }
    const signatures = declaration.statements.filter(s => s.predicate === 'signature');
    if (predicate === 'signature') {
      for (const s of values) if (s.arguments.length < 2 || s.arguments.some(a => !isReference(a) || !get(a.ref)))
        problem('invalid-signature', 'Signature requires declared types for subject and every argument');
    } else {
      if (signatures.length !== 1) problem('invalid-signature', 'Predicate requires one unambiguous signature: ' + predicate);
      for (const s of values) for (const signature of signatures) {
        const tuple: Value[] = [{ ref: id }, ...s.arguments];
        if (tuple.length !== signature.arguments.length || tuple.some((v, i) => !matches(v, signature.arguments[i])))
          problem('invalid-statement', 'Statement violates signature: ' + predicate);
      }
    }
    const unique = declaration.statements.some(s => s.predicate === 'unique' && s.arguments.length === 1 && s.arguments[0] === true);
    if (unique && values.length > 1) {
      conflicts.push({ predicate, values: values.map(s => s.arguments) });
      problem('inheritance-conflict', 'Incompatible unique tuples for ' + predicate + '; no declaration was overridden');
    }
  }
  return { id, lineage: [...paths].map(([id, path]) => ({ id, path })), inheritance, definitions, statements, conflicts, diagnostics, complete: diagnostics.length === 0 };
}
// @logos-id resolve-inheritance
export type EffectiveDefinition = ReturnType<typeof resolveInheritance>;
