import ts from 'typescript';
import { idSchema, issue, makeNode, rejectSharedTargets, without, type Reader, type SourceInput, type Span, type ReadResult } from './model.js';

export function readTypeScript(source: SourceInput): ReadResult {
  const scriptKind = source.path.endsWith('.tsx') ? ts.ScriptKind.TSX : source.path.endsWith('.jsx') ? ts.ScriptKind.JSX : ts.ScriptKind.TS;
  const ast = ts.createSourceFile(source.path, source.text.replace(/^\uFEFF#!/, '\uFEFF//'), ts.ScriptTarget.Latest, true, scriptKind);
  const errors = (ast as ts.SourceFile & { parseDiagnostics: ts.DiagnosticWithLocation[] }).parseDiagnostics;
  if (errors.length) return { nodes: [], diagnostics: errors.map(e => issue(source, 'source-syntax', ts.flattenDiagnosticMessageText(e.messageText, '\n'), e.start)) };
  const comments = new Map<number, Span>();
  const targets: { span: Span; name: string; kind: string }[] = [];
  function visit(node: ts.Node) {
    for (const range of [...(ts.getLeadingCommentRanges(ast.text, node.pos) ?? []), ...(ts.getTrailingCommentRanges(ast.text, node.end) ?? [])]) comments.set(range.pos, { start: range.pos, end: range.end });
    const supported = ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isMethodDeclaration(node)
      || ts.isExpressionStatement(node) || (ts.isVariableStatement(node) && node.declarationList.declarations.length === 1);
    if (supported) {
      const named = node as ts.NamedDeclaration;
      const name = ts.isVariableStatement(node) ? node.declarationList.declarations[0].name.getText(ast)
        : ts.isExpressionStatement(node) ? node.expression.getText(ast).split('\n')[0].slice(0, 100) : named.name?.getText(ast);
      targets.push({ span: { start: node.getStart(ast), end: node.end }, name: name ?? 'default', kind: ts.SyntaxKind[node.kind] });
    }
    // Closing-brace and EOF trivia include trailing IDs after the last member.
    for (const child of node.getChildren(ast)) visit(child);
  }
  visit(ast);
  const allComments = [...comments.values()].sort((a, b) => a.start - b.start);
  const result: ReadResult = { nodes: [], diagnostics: [] };
  for (const marker of allComments) {
    const raw = source.text.slice(marker.start, marker.end);
    if (/^\/\*\s*@logos(?:\s|$)/.test(raw)) {
      result.diagnostics.push(issue(source, 'legacy-source-annotation', 'Move source metadata and relations to Logos Markdown; replace this block with // @logos-id ID', marker.start));
      continue;
    }
    if (!/^\/\/\s*@logos-id(?:\s|$)/.test(raw)) continue;
    try {
      const match = /^\/\/[ \t]*@logos-id[ \t]+([^\s#]+)[ \t]*$/.exec(raw);
      if (!match) throw new Error('Source anchors contain only // @logos-id ID');
      const lineStart = source.text.lastIndexOf('\n', marker.start - 1) + 1;
      if (source.text.slice(lineStart, marker.start).trim()) throw new Error('Place the ID on its own line after its target');
      const target = targets.filter(t => t.span.end <= marker.start).sort((a, b) => b.span.end - a.span.end)[0];
      if (!target || without(source.text, { start: target.span.end, end: marker.start }, allComments).trim()) throw new Error('ID does not immediately follow a supported declaration or expression statement');
      // The code contributes identity and its current location, never semantic links or metadata.
      result.nodes.push(makeNode(source, { id: idSchema.parse(match[1]), statements: [] }, marker, target.span,
        { start: target.span.start, end: marker.end }, target.name, 'typescript', target.kind));
    } catch (error) { result.diagnostics.push(issue(source, 'invalid-source-anchor', String(error), marker.start)); }
  }
  return rejectSharedTargets(source, result);
}
// @logos-id read-typescript
export const typescriptReader: Reader = { id: 'typescript', extensions: ['.ts', '.tsx', '.js', '.mjs', '.cjs', '.jsx'], read: readTypeScript };
