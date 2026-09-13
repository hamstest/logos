import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readMarkdown, insertDefinition } from '../src/knowledge/markdown.js';
import { readTypeScript } from '../src/knowledge/typescript.js';
import { parseDefinition } from '../src/knowledge/model.js';
import { KnowledgeGraph } from '../src/knowledge/graph.js';
const source = (text: string, path = 'test.md', scope = 'shared') => ({text,path,scope,rootId:'test'});
const mark = (id: string, facts = '', body = '# '+id) => insertDefinition(body,parseDefinition('def '+id+'\n'+facts.split('\n').filter(Boolean).map(l=>'  '+l).join('\n')));
const vocabulary = () => readMarkdown(source(readFileSync('knowledge/shared/language.md','utf8'),'language.md'));
const code = (id: string) => '// @logos-id '+id+'\n';

describe('verify-knowledge', () => {
test('Headings own definitions below them, including child sections and exact sibling boundaries', () => {
  const a=mark('parent','','# Parent\nIntro\n'),b=mark('child','','## Child\nNested\n'),c=mark('next','','# Next\nFinal\n');
  const text=a+b+c,r=readMarkdown(source(text));
  assert.deepEqual(r.diagnostics,[]);
  assert.deepEqual(r.nodes.map(n=>n.id),['parent','child','next']);
  assert.equal(r.nodes[0].content,'# Parent\nIntro\n\n\n## Child\nNested');
  assert.equal(text.slice(r.nodes[0].origin.edit.end),c);
  assert.equal(text.slice(r.nodes[0].origin.edit.start,r.nodes[0].origin.edit.end),a+b);
  assert.equal(readMarkdown(source('~~~~markdown\n'+mark('literal')+'~~~~\n')).nodes.length,0);
  assert.equal(readMarkdown(source(mark('quote').split('\n').map(l=>'> '+l).join('\n'))).nodes.length,0);
});

test('Malformed, preceding, separated and duplicate definitions are diagnosed', () => {
  const fence=(id:string)=>'~~~logos\ndef '+id+'\n~~~\n';
  for(const text of [fence('a')+'# H', '# H\n'+fence('a')+'paragraph\n', '# H\n'+fence('a')+fence('b'), '# H\n~~~logos\ndef a\ndef b\n~~~']) {
    const r=readMarkdown(source(text));assert.equal(r.nodes.length,0,text);assert.ok(r.diagnostics.length);
  }
  assert.throws(()=>insertDefinition('Plain prose',{id:'file',statements:[]}));
});

test('Setext headings, CRLF and BOM preserve ownership and offsets', () => {
  const raw='\uFEFFTitle\r\n=====\r\n\r\nBody\r\n\r\n~~~logos\r\ndef first\r\n~~~\r\n\r\n# Next\r\n';
  const r=readMarkdown(source(raw));
  assert.deepEqual(r.diagnostics,[]);assert.equal(r.nodes[0].id,'first');assert.equal(r.nodes[0].origin.edit.start,0);
  assert.equal(raw.slice(r.nodes[0].origin.edit.end),'# Next\r\n');
  assert.match(r.nodes[0].content,/Title\r\n=====/);
});

test('TypeScript reads trailing IDs without executing code and retains IDs through renames', () => {
  const text = "throw new Error('MUST NOT EXECUTE');\nexport function f() {}\n"+code('fn')
    +'class C {\nm() {}\n'+code('method')+'}\n'+code('cls')+'const f2 = () => 1;\n'+code('arrow');
  const r=readTypeScript(source(text,'code.ts'));
  assert.deepEqual(r.diagnostics,[]);assert.deepEqual(r.nodes.map(n=>n.id),['fn','method','cls','arrow']);
  assert.equal(r.nodes[0].content,'export function f() {}');
  assert.equal(readTypeScript(source(text.replace('function f()','function renamed()'),'moved.ts')).nodes[0].id,'fn');
  const adjacent=readTypeScript(source('function first() {}\n'+code('first')+'function second() {}\n'+code('second'),'adjacent.ts'));
  assert.deepEqual(adjacent.nodes.map(n=>[n.id,n.title]),[['first','first'],['second','second']]);
});

test('Source literals and unsupported preceding targets cannot create or steal IDs', () => {
  const literal=JSON.stringify(code('fake'));
  assert.equal(readTypeScript(source('const s = '+literal+'; const r = /foo/;','a.ts')).nodes.length,0);
  for(const text of ['function f() {}\ninterface I {}\n'+code('x'),'const a = 1, b = 2;\n'+code('x'),code('x')+'function f() {}','function f() {}\n'+code('a')+code('b'),'function f() {}\n'+code('old/name')]){
    const r=readTypeScript(source(text,'a.ts'));assert.equal(r.nodes.length,0);assert.ok(r.diagnostics.length);
  }
  assert.equal(readTypeScript(source('function broken( {\n'+code('x'),'a.ts')).diagnostics[0].code,'source-syntax');
  const bom=readTypeScript(source('\uFEFF#!/usr/bin/env node\nfunction main() {}\n'+code('bom-ts'),'cli.ts'));
  assert.deepEqual(bom.diagnostics,[]);assert.equal(bom.nodes[0].content,'function main() {}');
});

test('All parents supply criteria before pagination independently of lexical rank', () => {
  const docs=[mark('child','is left, right'),mark('left','governed-by rule1'),mark('right','governed-by rule2'),mark('rule1','is criterion'),mark('rule2','is criterion')];
  for(let i=0;i<30;i++)docs.push(mark('noise'+i,'','# Noise'));
  const g=new KnowledgeGraph([vocabulary(),...docs.map((d,i)=>readMarkdown(source(d,i+'.md')))]);
  const page=g.context({concepts:['child'],query:'noise',limit:1});
  assert.equal(page.items[0].node.id,'rule1');assert.equal(page.nextOffset,1);
  assert.equal(g.context({concepts:['child'],limit:1,offset:1}).items[0].node.id,'rule2');
  assert.ok(g.related('left').some(e=>e.source==='child'&&e.relation==='is'));
});

test('Scope boundaries, duplicates, unresolved references and cycles stay visible', () => {
  const g=new KnowledgeGraph([vocabulary(),readMarkdown(source(mark('shared'))),
    readMarkdown(source(mark('private','depends-on shared'),'p.md','p')),
    readMarkdown(source(mark('cycle','is cycle\ndepends-on missing'))),
    readMarkdown(source(mark('dup'),'d1.md')),readMarkdown(source(mark('dup'),'d2.md'))]);
  assert.equal(g.related('shared').length,0);assert.equal(g.related('shared','p').length,1);
  assert.equal(g.get('private'),undefined);assert.equal(g.get('dup'),undefined);
  assert.ok(g.context({concepts:['cycle']}).incomplete);
  assert.ok(g.problems().some(d=>d.code==='hierarchy-cycle'));
  assert.ok(g.problems().some(d=>d.code==='unresolved-reference'));
});
});
// @logos-id verify-knowledge
