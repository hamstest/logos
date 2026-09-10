import { createHash } from 'node:crypto';
import { parseDocument } from 'yaml';
import { z } from 'zod';

export interface Span { start: number; end: number }
export interface SourceInput { rootId: string; path: string; text: string; scope: string }
export interface Diagnostic {
  code: string; message: string; rootId?: string; path?: string; line?: number;
  scope?: string; nodeId?: string;
}
export interface Link { relation: string; target: string }
export interface Annotation {
  format: 1; id: string; kind: string; title?: string; aliases?: string[];
  attach?: 'next' | 'file'; scope?: string; links?: Link[]; [key: string]: unknown;
}
export interface KnowledgeNode {
  id: string; kind: string; title: string; aliases: string[]; scope: string;
  links: Link[]; content: string; metadata: Annotation;
  origin: {
    rootId: string; path: string; language: string; hash: string;
    annotation: Span; content: Span; edit: Span; line: number; targetKind: string;
  };
}
export interface ReadResult { nodes: KnowledgeNode[]; diagnostics: Diagnostic[] }
export interface Reader { id: string; extensions: string[]; read(source: SourceInput): ReadResult }

const annotationSchema = z.object({
  format: z.literal(1), id: z.string().regex(/^[^\s#]+$/), kind: z.string().min(1),
  title: z.string().optional(), aliases: z.array(z.string()).optional(),
  attach: z.enum(['next', 'file']).optional(), scope: z.string().min(1).optional(),
  links: z.array(z.object({ relation: z.string().min(1), target: z.string().min(1) })).optional(),
}).passthrough();

export const hash = (text: string) => createHash('sha256').update(text).digest('hex');
export const lineAt = (text: string, offset: number) => text.slice(0, offset).split('\n').length;
export function issue(source: SourceInput, code: string, message: string, offset = 0): Diagnostic {
  return { code, message, rootId: source.rootId, path: source.path, scope: source.scope, line: lineAt(source.text, offset) };
}
export function annotation(text: string): Annotation {
  const doc = parseDocument(text, { uniqueKeys: true });
  if (doc.errors.length) throw new Error(doc.errors.map(e => e.message).join('; '));
  return annotationSchema.parse(doc.toJS({ maxAliasCount: 30 })) as Annotation;
}
export function without(text: string, span: Span, exclusions: Span[]): string {
  let position = span.start;
  let result = '';
  for (const part of exclusions.filter(p => p.start >= span.start && p.end <= span.end).sort((a, b) => a.start - b.start)) {
    if (part.start < position) continue;
    result += text.slice(position, part.start);
    position = part.end;
  }
  return result + text.slice(position, span.end);
}
export function makeNode(source: SourceInput, data: Annotation, marker: Span, body: Span, edit: Span,
  title: string, language: string, targetKind: string, exclusions: Span[] = []): KnowledgeNode {
  return {
    id: data.id, kind: data.kind, title: data.title ?? title, aliases: data.aliases ?? [],
    scope: data.scope ?? source.scope, links: data.links ?? [], metadata: data,
    content: without(source.text, body, exclusions).trim(),
    origin: { rootId: source.rootId, path: source.path, language, hash: hash(source.text),
      annotation: marker, content: body, edit, line: lineAt(source.text, body.start), targetKind },
  };
}
export function rejectSharedTargets(source: SourceInput, result: ReadResult): ReadResult {
  const groups = new Map<string, KnowledgeNode[]>();
  for (const node of result.nodes) {
    const key = `${node.origin.content.start}:${node.origin.content.end}`;
    groups.set(key, [...(groups.get(key) ?? []), node]);
  }
  const rejected = new Set<string>();
  for (const group of groups.values()) if (group.length > 1) {
    for (const node of group) {
      rejected.add(node.id);
      result.diagnostics.push(issue(source, 'ambiguous-target', 'Multiple annotations attach to the same target', node.origin.annotation.start));
    }
  }
  result.nodes = result.nodes.filter(n => !rejected.has(n.id));
  return result;
}
