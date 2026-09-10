import ts from 'typescript';
import { annotation, issue, makeNode, rejectSharedTargets, without, type Reader, type SourceInput, type Span, type ReadResult } from './model.js';

/* @logos
format: 1
id: implementation/read-typescript
kind: implementation
links:
  - relation: implements
    target: criterion/annotation-boundaries
*/
export function readTypeScript(source: SourceInput): ReadResult {
  const scriptKind = source.path.endsWith('.tsx') ? ts.ScriptKind.TSX : source.path.endsWith('.jsx') ? ts.ScriptKind.JSX : ts.ScriptKind.TS;
  const ast = ts.createSourceFile(source.path, source.text.replace(/^\uFEFF#!/, '\uFEFF//'), ts.ScriptTarget.Latest, true, scriptKind);
  const errors = (ast as ts.SourceFile & { parseDiagnostics: ts.DiagnosticWithLocation[] }).parseDiagnostics;
  if (errors.length) return { nodes: [], diagnostics: errors.map(e => issue(source, 'source-syntax', ts.flattenDiagnosticMessageText(e.messageText, '\n'), e.start)) };
  const comments = new Map<number, Span>();
  const targets: { span: Span; name: string; kind: string }[] = [];
  function visit(node: ts.Node) {
    for (const range of [...(ts.getLeadingCommentRanges(ast.text, node.pos) ?? []), ...(ts.getTrailingCommentRanges(ast.text, node.end) ?? [])]) {
      comments.set(range.pos, { start: range.pos, end: range.end });
    }
    const supported = ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isMethodDeclaration(node)
      || (ts.isVariableStatement(node) && node.declarationList.declarations.length === 1);
    if (supported) {
      const named = node as ts.NamedDeclaration;
      const name = ts.isVariableStatement(node) ? node.declarationList.declarations[0].name.getText(ast) : named.name?.getText(ast);
      targets.push({ span: { start: node.getStart(ast), end: node.end }, name: name ?? 'default', kind: ts.SyntaxKind[node.kind] });
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  const allComments = [...comments.values()].sort((a, b) => a.start - b.start);
  const markers = allComments.filter(r => /^\/\*\s*@logos(?:\s|$)/.test(source.text.slice(r.start, r.end)));
  const result: ReadResult = { nodes: [], diagnostics: [] };
  for (const marker of markers) {
    try {
      const raw = source.text.slice(marker.start, marker.end).replace(/^\/\*\s*@logos\s*/, '').replace(/\*\/$/, '');
      const data = annotation(raw);
      if (data.attach === 'file') {
        if (without(source.text, { start: 0, end: marker.start }, allComments).trim()) throw new Error('File annotation must precede source declarations');
        const all = { start: 0, end: source.text.length };
        result.nodes.push(makeNode(source, data, marker, all, all, source.path, 'typescript', 'file'));
        continue;
      }
      const target = targets.filter(t => t.span.start >= marker.end).sort((a, b) => a.span.start - b.span.start)[0];
      if (!target || without(source.text, { start: marker.end, end: target.span.start }, allComments).trim()) throw new Error('Annotation does not immediately precede a supported declaration');
      result.nodes.push(makeNode(source, data, marker, target.span, { start: marker.start, end: target.span.end }, target.name, 'typescript', target.kind));
    } catch (error) {
      result.diagnostics.push(issue(source, 'invalid-annotation', String(error), marker.start));
    }
  }
  return rejectSharedTargets(source, result);
}
export const typescriptReader: Reader = { id: 'typescript', extensions: ['.ts', '.tsx', '.js', '.mjs', '.cjs', '.jsx'], read: readTypeScript };
