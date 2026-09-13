import { createHash } from 'node:crypto';
import { z } from 'zod';

export interface Span { start: number; end: number }
export interface SourceInput { rootId: string; path: string; text: string; scope: string }
export interface Diagnostic { code: string; message: string; rootId?: string; path?: string; line?: number; scope?: string; nodeId?: string }
export type Value = { ref: string } | string | number | boolean;
export interface Statement { predicate: string; arguments: Value[] }
export interface Definition { id: string; statements: Statement[] }
export interface KnowledgeNode extends Definition {
  title: string; aliases: string[]; scope: string; content: string;
  origin: { rootId: string; path: string; language: string; hash: string;
    annotation: Span; content: Span; edit: Span; line: number; targetKind: string };
}
export interface ReadResult { nodes: KnowledgeNode[]; diagnostics: Diagnostic[] }
export interface Reader { id: string; extensions: string[]; read(source: SourceInput): ReadResult }
const identifier = /^[A-Za-z_][A-Za-z0-9_-]*$/;
export const idSchema = z.string().regex(identifier).refine(id => !['true', 'false'].includes(id), 'Boolean literals are not IDs');
export const valueSchema = z.union([z.object({ ref: idSchema }).strict(), z.string(), z.number().finite(), z.boolean()]);
export const statementSchema = z.object({ predicate: idSchema, arguments: z.array(valueSchema).min(1) }).strict();
export const definitionSchema = z.object({ id: idSchema, statements: z.array(statementSchema) }).strict();
export const ref = (id: string): { ref: string } => ({ ref: id });
export const statement = (predicate: string, ...args: Value[]): Statement => ({ predicate, arguments: args });
export const isReference = (value: Value): value is { ref: string } => typeof value === 'object';
export function targets(statements: Statement[], predicate: string): string[] {
  return statements.filter(s => s.predicate === predicate && s.arguments.length === 1 && isReference(s.arguments[0])).map(s => (s.arguments[0] as { ref: string }).ref);
}
/** A navigable projection retains the entire tuple and its referenced argument position. */
export function referenceEdges<T extends Statement>(statements: T[]) {
  return statements.flatMap(s => s.arguments.flatMap((arg, position) => isReference(arg)
    ? [{ relation: s.predicate, target: arg.ref, position, statement: { predicate: s.predicate, arguments: s.arguments }, origins: 'origins' in s ? s.origins as {nodeId: string; path: string[]}[] : undefined }] : []));
}
export const hash = (text: string) => createHash('sha256').update(text).digest('hex');
export const lineAt = (text: string, offset: number) => text.slice(0, offset).split('\n').length;
export function issue(source: SourceInput, code: string, message: string, offset = 0): Diagnostic {
  return { code, message, rootId: source.rootId, path: source.path, scope: source.scope, line: lineAt(source.text, offset) };
}
export function parseDefinition(text: string): Definition {
  const lines = text.trimEnd().split(/\r?\n/);
  const header = /^def ([A-Za-z_][A-Za-z0-9_-]*)$/.exec(lines.shift() ?? '');
  if (!header) throw new Error('A definition starts with def and a flat ID');
  const statements: Statement[] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    const match = /^  ([A-Za-z_][A-Za-z0-9_-]*) (.+)$/.exec(line);
    if (!match) throw new Error('A statement requires two spaces, a predicate and values');
    let rest = match[2];
    const value = (): Value => {
      rest = rest.trimStart();
      const token = /^(?:"(?:[^"\\]|\\.)*"|[^,\s()]+)/.exec(rest);
      if (!token) throw new Error('Expected a reference or literal: ' + rest);
      const word = token[0]; rest = rest.slice(word.length).trimStart();
      if (word.startsWith('"')) return JSON.parse(word);
      if (/^(true|false)$/.test(word)) return word === 'true';
      if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(word) && Number.isFinite(Number(word))) return Number(word);
      if (identifier.test(word)) return ref(idSchema.parse(word));
      throw new Error('Invalid reference or literal: ' + word);
    };
    while (rest) {
      const args: Value[] = [];
      if (rest.startsWith('(')) {
        rest = rest.slice(1); args.push(value());
        while (rest.startsWith(',')) { rest = rest.slice(1); args.push(value()); }
        if (!rest.startsWith(')') || args.length < 2) throw new Error('A tuple requires at least two arguments and a closing parenthesis');
        rest = rest.slice(1).trimStart();
      } else args.push(value());
      statements.push(statement(match[1], ...args));
      if (rest) {
        if (!rest.startsWith(',')) throw new Error('Separate repeated statements with a comma');
        rest = rest.slice(1).trimStart();
        if (!rest) throw new Error('Trailing comma');
      }
    }
  }
  return definitionSchema.parse({ id: header[1], statements });
}
// @logos-id parse-annotation
export function serializeDefinition(data: Definition): string {
  definitionSchema.parse({ id: data.id, statements: data.statements });
  const groups = new Map<string, string[]>();
  for (const s of data.statements) {
    const args = s.arguments.map(a => isReference(a) ? a.ref : JSON.stringify(a));
    const item = args.length === 1 ? args[0] : '(' + args.join(', ') + ')';
    groups.set(s.predicate, [...groups.get(s.predicate) ?? [], item]);
  }
  return 'def ' + data.id + '\n' + [...groups].map(([predicate, values]) => '  ' + predicate + ' ' + values.join(', ') + '\n').join('');
}
export function without(text: string, span: Span, exclusions: Span[]): string {
  let position = span.start, result = '';
  for (const part of exclusions.filter(p => p.start >= span.start && p.end <= span.end).sort((a, b) => a.start - b.start)) {
    if (part.start < position) continue;
    result += text.slice(position, part.start); position = part.end;
  }
  return result + text.slice(position, span.end);
}
export function makeNode(source: SourceInput, data: Definition, marker: Span, body: Span, edit: Span,
  title: string, language: string, targetKind: string, exclusions: Span[] = []): KnowledgeNode {
  return { ...data, title, aliases: data.statements.filter(s => s.predicate === 'alias').flatMap(s => s.arguments.filter((a): a is string => typeof a === 'string')),
    scope: source.scope, content: without(source.text, body, exclusions).trim(),
    origin: { rootId: source.rootId, path: source.path, language, hash: hash(source.text),
      annotation: marker, content: body, edit, line: lineAt(source.text, body.start), targetKind } };
}
// @logos-id make-node
export function rejectSharedTargets(source: SourceInput, result: ReadResult): ReadResult {
  const groups = new Map<string, KnowledgeNode[]>();
  for (const node of result.nodes) {
    const key = `${node.origin.content.start}:${node.origin.content.end}`;
    groups.set(key, [...groups.get(key) ?? [], node]);
  }
  const rejected = new Set<string>();
  for (const group of groups.values()) if (group.length > 1) for (const node of group) {
    rejected.add(node.id);
    result.diagnostics.push(issue(source, 'ambiguous-target', 'Multiple definitions attach to the same heading', node.origin.annotation.start));
  }
  result.nodes = result.nodes.filter(n => !rejected.has(n.id)); return result;
}
