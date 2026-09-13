import MarkdownIt from 'markdown-it';
import { parseDefinition, serializeDefinition, issue, makeNode, rejectSharedTargets, type Definition, type Reader, type SourceInput, type Span, type ReadResult } from './model.js';
const parser = new MarkdownIt();
function parse(text: string) {
  const tokens = parser.parse(text.replace(/^\uFEFF/, ' '), {});
  const offsets = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') offsets.push(i + 1);
  return { tokens, offset: (line: number) => offsets[line] ?? text.length };
}
export function insertDefinition(body: string, data: Definition): string {
  const text = body.trimEnd() + '\n', { tokens, offset } = parse(text), heading = tokens[0];
  if (heading?.type !== 'heading_open' || heading.level !== 0 || !heading.map || text.slice(0, offset(heading.map[0])).trim()) throw new Error('A managed section must start with a heading');
  const next = tokens.slice(1).find(t => t.type === 'heading_open' && t.level === 0);
  const end = next ? offset(next.map![0]) : text.length;
  return text.slice(0, end).trimEnd() + '\n\n~~~logos\n' + serializeDefinition(data) + '~~~\n\n' + text.slice(end);
}
export function readMarkdown(source: SourceInput): ReadResult {
  const { tokens, offset } = parse(source.text);
  const isMarker = (token: typeof tokens[number] | undefined) => token?.type === 'fence' && token.level === 0 && token.info.trim() === 'logos';
  const markers = tokens.map((token, index) => ({ token, index })).filter(({ token }) => isMarker(token));
  const ranges: Span[] = markers.map(({ token }) => ({ start: offset(token.map![0]), end: offset(token.map![1]) }));
  const result: ReadResult = { nodes: [], diagnostics: [] };
  for (let m = 0; m < markers.length; m++) {
    const { token, index } = markers[m], marker = ranges[m];
    try {
      const data = parseDefinition(token.content);
      let previous = index - 1;
      while (previous >= 0 && !(tokens[previous].type === 'heading_open' && tokens[previous].level === 0)) previous--;
      const heading = tokens[previous];
      if (!heading?.map) throw new Error('A definition must follow a heading and its description');
      let after = index + 1;
      while (isMarker(tokens[after])) after++;
      if (after < tokens.length && !(tokens[after].type === 'heading_open' && tokens[after].level === 0))
        throw new Error('Place the definition after the description, before the next heading');
      let end = source.text.length;
      for (let t = index + 1; t < tokens.length; t++) {
        const next = tokens[t];
        if (next.type === 'heading_open' && next.level === 0 && Number(next.tag.slice(1)) <= Number(heading.tag.slice(1))) { end = offset(next.map![0]); break; }
      }
      const body = { start: offset(heading.map[0]), end };
      result.nodes.push(makeNode(source, data, marker, body, body,
        tokens[previous + 1]?.content ?? source.path, 'markdown', 'section', ranges));
    } catch (error) { result.diagnostics.push(issue(source, 'invalid-annotation', String(error), marker.start)); }
  }
  return rejectSharedTargets(source, result);
}
// @logos-id read-markdown
export const markdownReader: Reader = { id: 'markdown', extensions: ['.md', '.markdown'], read: readMarkdown };
