import MarkdownIt from 'markdown-it';
import { annotation, issue, makeNode, rejectSharedTargets, type Reader, type SourceInput, type Span, type ReadResult } from './model.js';

const parser = new MarkdownIt();

/* @logos
format: 1
id: implementation/read-markdown
kind: implementation
links:
  - relation: implements
    target: criterion/annotation-boundaries
*/
export function readMarkdown(source: SourceInput): ReadResult {
  const tokens = parser.parse(source.text.replace(/^\uFEFF/, ' '), {});
  const offsets = [0];
  for (let i = 0; i < source.text.length; i++) if (source.text[i] === '\n') offsets.push(i + 1);
  const offset = (line: number) => offsets[line] ?? source.text.length;
  const markers = tokens.map((token, index) => ({ token, index }))
    .filter(({ token }) => token.type === 'fence' && token.level === 0 && token.info.trim() === 'logos');
  const ranges: Span[] = markers.map(({ token }) => ({ start: offset(token.map![0]), end: offset(token.map![1]) }));
  const result: ReadResult = { nodes: [], diagnostics: [] };
  for (let m = 0; m < markers.length; m++) {
    const { token, index } = markers[m];
    const marker = ranges[m];
    try {
      const data = annotation(token.content);
      if (data.attach === 'file') {
        if (source.text.slice(0, marker.start).trim()) throw new Error('File annotations must be at the start of the document');
        const all = { start: 0, end: source.text.length };
        result.nodes.push(makeNode(source, data, marker, all, all, source.path, 'markdown', 'file', ranges));
        continue;
      }
      // Adjacent marker groups are processed together so duplicate attachments are rejected.
      let nextIndex = index + 1;
      while (tokens[nextIndex]?.type === 'fence' && tokens[nextIndex].level === 0 && tokens[nextIndex].info.trim() === 'logos') nextIndex++;
      const heading = tokens[nextIndex];
      if (heading?.type !== 'heading_open' || heading.level !== 0 || !heading.map) throw new Error('Annotation must immediately precede a heading');
      const gap = source.text.slice(marker.end, offset(heading.map[0]));
      const intervening = ranges.filter(r => r.start >= marker.end && r.end <= offset(heading.map![0]));
      let remaining = gap;
      for (const r of [...intervening].reverse()) remaining = remaining.slice(0, r.start - marker.end) + remaining.slice(r.end - marker.end);
      if (remaining.trim()) throw new Error('Text between annotation and heading');
      let end = source.text.length;
      const rank = Number(heading.tag.slice(1));
      for (let t = nextIndex + 1; t < tokens.length; t++) {
        const next = tokens[t];
        if (next.type !== 'heading_open' || next.level !== 0 || Number(next.tag.slice(1)) > rank) continue;
        end = offset(next.map![0]);
        // The marker immediately preceding the next chapter belongs to that chapter.
        for (let p = t - 1; p >= 0; p--) {
          const prior = tokens[p];
          if (prior.type !== 'fence' || prior.level !== 0 || prior.info.trim() !== 'logos') break;
          if (source.text.slice(offset(prior.map![1]), end).trim()) break;
          end = offset(prior.map![0]);
        }
        break;
      }
      const body = { start: offset(heading.map[0]), end };
      result.nodes.push(makeNode(source, data, marker, body, { start: marker.start, end },
        tokens[nextIndex + 1]?.content ?? source.path, 'markdown', 'section', ranges));
    } catch (error) {
      result.diagnostics.push(issue(source, 'invalid-annotation', String(error), marker.start));
    }
  }
  return rejectSharedTargets(source, result);
}
export const markdownReader: Reader = { id: 'markdown', extensions: ['.md', '.markdown'], read: readMarkdown };
