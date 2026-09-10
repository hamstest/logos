import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readMarkdown } from '../src/knowledge/markdown.js';
import { readTypeScript } from '../src/knowledge/typescript.js';
import { KnowledgeGraph } from '../src/knowledge/graph.js';
const source = (text: string, path = 'test.md', scope = 'shared') => ({ text, path, scope, rootId: 'test' });
const mark = (id: string, extra = '') => '```logos\nformat: 1\nid: ' + id + '\nkind: concept\n' + extra + '\n```\n';
const code = (id: string, extra = '') => '/* @logos\nformat: 1\nid: ' + id + '\nkind: implementation\n' + extra + '\n*/\n';

test('Markdown scopes include children, exclude following annotations and preserve literal examples', () => {
  const text = mark('parent') + '# Parent\nIntro\n' + mark('child') + '## Child\nNested\n' + mark('next') + '# Next\nFinal\n';
  const r = readMarkdown(source(text));
  assert.equal(r.diagnostics.length, 0);
  assert.deepEqual(r.nodes.map(n => n.id), ['parent', 'child', 'next']);
  assert.equal(r.nodes[0].content, '# Parent\nIntro\n## Child\nNested');
  assert.equal(text.slice(r.nodes[0].origin.edit.end), mark('next') + '# Next\nFinal\n');
  const examples = '````md\n' + mark('fake') + '# Fake\n````\n\n> ' + mark('quoted').replaceAll('\n', '\n> ') + '\n';
  assert.equal(readMarkdown(source(examples)).nodes.length, 0);
});
test('Markdown reports malformed, misplaced, and ambiguous annotations', () => {
  for (const text of [mark('a') + 'Paragraph\n# Heading', mark('a') + mark('b') + '# Heading', '```logos\nformat: 1\nid: a\nid: b\nkind: concept\n```\n# H']) {
    const r = readMarkdown(source(text)); assert.equal(r.nodes.length, 0); assert.ok(r.diagnostics.length);
  }
  assert.equal(readMarkdown(source(mark('file', 'attach: file') + 'Plain prose')).nodes[0].content, 'Plain prose');
});
test('TypeScript discovers actual declarations without executing source', () => {
  const text = "throw new Error('MUST NOT EXECUTE');\n" + code('fn') + 'export function f() {}\n' + code('cls') + 'class C {\n' + code('method') + 'm() {}\n}\n' + code('arrow') + 'const f2 = () => 1;';
  const r = readTypeScript(source(text, 'example.ts'));
  assert.deepEqual(r.diagnostics, []);
  assert.deepEqual(r.nodes.map(n => n.id), ['fn', 'cls', 'method', 'arrow']);
  assert.equal(r.nodes[0].content, 'export function f() {}');
  const renamed = readTypeScript(source(text.replace('function f()', 'function renamed()'), 'moved.ts'));
  assert.equal(renamed.nodes[0].id, 'fn');
});
test('TypeScript does not interpret strings, templates, regexes, or jump past unsupported targets', () => {
  const literal = JSON.stringify(code('fake'));
  assert.equal(readTypeScript(source('const s = ' + literal + '; const t = `' + code('fake2') + '`; const r = /foo/;', 'a.ts')).nodes.length, 0);
  for (const text of [code('x') + 'console.log(1); function f() {}', code('x') + 'const a = 1, b = 2;', code('x'), code('a') + code('b') + 'function f() {}']) {
    const r = readTypeScript(source(text, 'a.ts')); assert.equal(r.nodes.length, 0); assert.ok(r.diagnostics.length, text);
  }
  assert.equal(readTypeScript(source(code('x') + 'function broken( {', 'a.ts')).diagnostics[0].code, 'source-syntax');
});
test('Semantic selection walks all parents independently of lexical rank and paginates', () => {
  const docs = [mark('refund', 'links: [{relation: is_a, target: money}, {relation: is_a, target: external}]') + '# Refund', mark('money') + '# Money', mark('external') + '# External', mark('rule1', 'links: [{relation: applies_to, target: money}]') + '# Reconcile', mark('rule2', 'links: [{relation: applies_to, target: external}]') + '# Repetition'];
  for (let i = 0; i < 30; i++) docs.push(mark('noise' + i) + '# Refund noise');
  const g = new KnowledgeGraph(docs.map((d, i) => readMarkdown(source(d, i + '.md'))));
  const page = g.context({ concepts: ['refund'], query: 'noise', limit: 1 });
  assert.equal(page.items[0].node.id, 'rule1'); assert.equal(page.nextOffset, 1);
  assert.equal(g.context({ concepts: ['refund'], limit: 1, offset: 1 }).items[0].node.id, 'rule2');
  assert.deepEqual(g.related('money').map(e => e.source).sort(), ['refund', 'rule1']);
});
test('Project isolation, duplicate IDs, unresolved links and cycles remain visible', () => {
  const g = new KnowledgeGraph([
    readMarkdown(source(mark('shared') + '# Shared')),
    readMarkdown(source(mark('private', 'links: [{relation: depends_on, target: shared}]') + '# Private', 'p.md', 'project/p')),
    readMarkdown(source(mark('cycle', 'links: [{relation: is_a, target: cycle}, {relation: depends_on, target: missing}]') + '# Cycle')),
    readMarkdown(source(mark('dup') + '# D', 'd1.md')), readMarkdown(source(mark('dup') + '# D', 'd2.md')),
  ]);
  assert.equal(g.related('shared').length, 0); assert.equal(g.related('shared', 'project/p').length, 1);
  assert.equal(g.get('private'), undefined); assert.equal(g.get('dup'), undefined);
  assert.ok(g.context({ concepts: ['cycle'] }).incomplete);
  assert.ok(g.problems().some(d => d.code === 'hierarchy-cycle'));
  assert.ok(g.problems().some(d => d.code === 'unresolved-reference'));
});
