import type { KnowledgeNode } from './model.js';

export interface SearchDocument { node: KnowledgeNode; text: string; tokens?: string[] }
export interface SearchChannel { name: string; results: { id: string; score: number }[] }
export interface SearchProvider {
  id: string;
  search(input: { query: string; terms: string[]; project?: string; documents: { id: string; title: string; text: string }[] }): Promise<{ id: string; score: number }[]>;
}
export const normalize = (text: string) => text.normalize('NFKC').toLocaleLowerCase().trim();
const segmenter = new Intl.Segmenter('ja', { granularity: 'word' });
const stop = new Set(['の', 'は', 'を', 'が', 'に', 'で', 'と', 'も', 'へ', 'です', 'ます', 'する', 'した', 'して', 'ください', 'the', 'a', 'an', 'to', 'of', 'is']);
export function tokenize(text: string) {
  const spaced = text.replace(/([a-z])([A-Z])/g, '$1 $2');
  return [...segmenter.segment(normalize(spaced))].filter(s => s.isWordLike && !stop.has(s.segment)).map(s => s.segment);
}

export function rankDocuments(documents: SearchDocument[], query: string, terms: string[] = [], channels: SearchChannel[] = []) {
  const words = [...new Set([query, ...terms].flatMap(tokenize))];
  const prepared = documents.map(({ node, text, tokens: indexedTokens }) => {
    const labels = [node.id, node.title, ...node.aliases].join(' ');
    const tokens = indexedTokens ?? tokenize(text), counts = new Map<string, number>();
    for (const word of tokens) counts.set(word, (counts.get(word) ?? 0) + 1);
    return { node, labels: new Set(tokenize(labels)), normalizedLabels: normalize(labels), counts, length: tokens.length };
  });
  const avg = prepared.reduce((n, p) => n + p.length, 0) / Math.max(1, prepared.length) || 1;
  const frequencies = new Map(words.map(word => [word, prepared.filter(p => p.counts.has(word) || p.labels.has(word)).length]));
  const lexical = prepared.map(p => {
    let score = 0;
    const matchedTerms: string[] = [];
    for (const word of words) {
      const frequency = p.counts.get(word) ?? 0;
      if (!frequency && !p.labels.has(word)) continue;
      const idf = Math.log(1 + (prepared.length - frequencies.get(word)! + 0.5) / (frequencies.get(word)! + 0.5));
      score += idf * (frequency * 2.2 / (frequency + 1.2 * (0.25 + 0.75 * p.length / avg)) + (p.labels.has(word) ? 3 : 0));
      matchedTerms.push(word);
    }
    for (const phrase of [query, ...terms].map(normalize).filter(Boolean)) if (p.normalizedLabels.includes(phrase)) score += 4;
    return { node: p.node, score, matchedTerms, channels: ['lexical'] };
  }).filter(r => r.score > 0).sort((a, b) => b.score - a.score || a.node.id.localeCompare(b.node.id));
  if (!channels.length) return lexical;
  const byId = new Map(documents.map(d => [d.node.id, d.node]));
  const merged = new Map<string, { node: KnowledgeNode; score: number; matchedTerms: string[]; channels: string[] }>();
  for (const channel of [{ name: 'lexical', results: lexical.map(r => ({ id: r.node.id, score: r.score })) }, ...channels]) {
    const valid = [...new Map(channel.results.filter(r => byId.has(r.id) && Number.isFinite(r.score) && r.score > 0).map(r => [r.id, r])).values()]
      .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
    valid.forEach((hit, i) => {
      const item = merged.get(hit.id) ?? { node: byId.get(hit.id)!, score: 0, matchedTerms: lexical.find(r => r.node.id === hit.id)?.matchedTerms ?? [], channels: [] };
      item.score += 1 / (60 + i + 1); item.channels.push(channel.name); merged.set(hit.id, item);
    });
  }
  return [...merged.values()].sort((a, b) => b.score - a.score || a.node.id.localeCompare(b.node.id));
}
// @logos-id search-knowledge
export type SearchHit = ReturnType<typeof rankDocuments>[number];
