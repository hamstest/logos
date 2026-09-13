import { describe, test, after } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { KnowledgeGraph } from '../src/knowledge/graph.js';
import { KnowledgeIndex } from '../src/knowledge/load.js';
import { parseDefinition, serializeDefinition, referenceEdges, targets } from '../src/knowledge/model.js';
import { readMarkdown, markdownReader, insertDefinition } from '../src/knowledge/markdown.js';
import { typescriptReader } from '../src/knowledge/typescript.js';
import { createHost as openHost } from '../src/app.js';
import type { ReadResult } from '../src/knowledge/model.js';
const hosts: Awaited<ReturnType<typeof openHost>>[] = [];
const createHost = async (dir: string) => { const h = await openHost(dir); hosts.push(h); return h; };
after(() => hosts.forEach(h => h.close()));
const mark = (id: string, facts = '', body = id) => insertDefinition('# '+body, parseDefinition('def '+id+'\n'+facts.split('\n').filter(Boolean).map(l=>'  '+l).join('\n')));
const md = (id: string, facts = '', body = id, scope = 'shared') => readMarkdown({ rootId: scope, path: id + '.md', scope, text: mark(id, facts, body) });
const vocabulary = () => readMarkdown({ rootId: 'shared', path: 'language.md', scope: 'shared', text: readFileSync('knowledge/shared/language.md', 'utf8') });
const graph = (...results: ReadResult[]) => new KnowledgeGraph([vocabulary(), ...results]);
const values = (g: KnowledgeGraph, id: string, predicate: string) => g.effective(id).statements.filter(s => s.predicate === predicate);

describe('Definitions, statements, mixins and indexed retrieval', () => {
test('The grammar distinguishes references and literals and rejects previous record syntax', () => {
  const text = 'def grammar\n  label "a, b"\n  tuple (target, "target", 1, false)\n';
  assert.equal(serializeDefinition(parseDefinition(text)), text);
  assert.deepEqual(parseDefinition(text).statements[1].arguments, [{ref:'target'},'target',1,false]);
  for (const invalid of ['format: 2\nid: x\nkind: concept', 'def x\nkind: concept', 'def x\n  p x,', 'def x\n  p "unterminated', 'def x\n  p 1e999', 'def x\n    p y', 'def x\n  p [1,2]', 'def x\ndef y'])
    assert.throws(() => parseDefinition(invalid), invalid);
  assert.ok(graph(md('x', 'missing x')).problems().some(d => d.code === 'unknown-predicate'));
});

test('Comma lists expand repeated statements while tuples retain their argument groups', () => {
  const d=parseDefinition('def grouped\n  is left, right\n  alias "a, (b)", "c"\n  association (left, 1), (right, 2)\n');
  assert.deepEqual(targets(d.statements,'is'),['left','right']);
  assert.deepEqual(d.statements.filter(s=>s.predicate==='association').map(s=>s.arguments),[[{ref:'left'},1],[{ref:'right'},2]]);
  assert.deepEqual(parseDefinition(serializeDefinition(d)),d);
  assert.equal(serializeDefinition(d).split('\n').filter(l=>l.startsWith('  is ')).length,1);
  for(const invalid of ['def old/name','def old%2Fname','def old.name','def true','def x\n  is old/name','def x\n  p (a)','def x\n  p (a, b','def x\n  p (a, b),','def x\n  p ((a, b), c)'])
    assert.throws(()=>parseDefinition(invalid),invalid);
});

test('Diamond inheritance unions all parent statements and bodies with declaring provenance', () => {
  const child = md('child', 'is left, right'), original = JSON.stringify(child);
  const g = graph(child, md('tags', 'signature (reference, string)'),
    md('left', 'is base\ntags "safe"', 'Left condition'),
    md('right', 'is base\ntags "retry", "safe"', 'Right condition'),
    md('base', 'implemented-by impl', 'All children preserve evidence'),
    typescriptReader.read({ rootId:'shared', path:'a.ts', scope:'shared', text:'function perform() {}\n// @logos-id impl' }));
  const e = g.effective('child');
  assert.deepEqual(e.diagnostics, []);
  assert.deepEqual(e.lineage.map(n => n.id), ['child','left','right','base']);
  assert.equal(e.inheritance.length, 4);
  assert.deepEqual(values(g,'child','tags').map(s => s.arguments[0]), ['retry','safe']);
  assert.equal(values(g,'child','tags').find(s => s.arguments[0] === 'safe')!.origins.length, 2);
  assert.match(e.definitions.find(d => d.id === 'base')!.content, /preserve evidence/);
  assert.deepEqual(g.related('impl',undefined,'in','implemented-by').map(e=>e.source).sort(), ['base','child','left','right']);
  assert.deepEqual(g.related('impl',undefined,'in','implemented-by','asserted').map(e=>e.source), ['base']);
  assert.equal(JSON.stringify(child),original);
});

test('Unique tuples conflict without child overrides or parent ordering; dependencies do not inherit', () => {
  const make = (parents: string[]) => graph(md('mode','signature (reference, string)\nunique true'),
    md('a','mode "strict"'), md('b','mode "loose"'), md('unrelated','alias "unwanted"'),
    md('child','is '+parents.join(', ')+'\nmode "custom"\ndepends-on unrelated'));
  const g = make(['a','b']), e=g.effective('child');
  assert.deepEqual(values(g,'child','mode').map(s=>s.arguments[0]),['custom','loose','strict']);
  assert.deepEqual(e.conflicts.map(c=>c.predicate),['mode']);
  assert.deepEqual(make(['b','a']).effective('child').statements,e.statements);
  assert.ok(!e.statements.some(s=>s.arguments.includes('unwanted')));
  assert.equal(e.complete,false);
});

test('Concrete definitions inherit using the same is; scopes, cycles and signatures are checked', () => {
  const g=graph(md('trait'),md('sub','is trait'),md('doc','is sub'),
    md('bad','is doc, missing, secret'),md('cycle','is cycle'),
    md('secret','','Confidential','other'),md('wrong','governed-by doc'));
  assert.deepEqual(new Set(targets(g.effective('doc').statements,'is')),new Set(['sub','trait']));
  assert.equal(g.effective('bad').diagnostics.filter(d=>d.code==='invalid-parent').length,2);
  assert.ok(g.effective('cycle').diagnostics.some(d=>d.code==='hierarchy-cycle'));
  assert.ok(g.effective('wrong').diagnostics.some(d=>d.code==='invalid-statement'));
  assert.ok(!JSON.stringify(g.search('Confidential')).includes('Confidential'));
});

test('Multi-argument relations preserve tuple association, positions and inherited predicate constraints', () => {
  const g=graph(md('association','signature (reference, reference, number)\nunique true'),
    md('specialized','is association'),md('target'),md('first','specialized (target, 1)'),
    md('second','specialized (target, 2)'),md('child','is first, second'));
  assert.deepEqual(values(g,'child','specialized').map(s=>s.arguments),[[{ref:'target'},1],[{ref:'target'},2]]);
  assert.ok(g.effective('child').conflicts.some(c=>c.predicate==='specialized'));
  const projected=g.related('child',undefined,'out','specialized');
  assert.equal(projected.length,2);
  assert.deepEqual(projected.map(e=>e.statement!.arguments[1]),[1,2]);
  assert.ok(projected.every(e=>e.position===0));
  const invalid=graph(md('p','signature (reference, reference, number)'),md('t'),md('bad','p (t, "wrong")'));
  assert.ok(invalid.effective('bad').diagnostics.some(d=>d.code==='invalid-statement'));
});

test('Body topic IDs merge caller IDs before inherited criteria and task use', () => {
  const g=graph(md('base','governed-by rule','Base'),md('topic','is base','Topic'),
    md('caller','','Known caller'),md('guide','is document\nabout topic','Prevent duplicate transmission'),
    md('rule','is criterion','Verify correspondence'));
  const r=g.context({query:'duplicate transmission',concepts:['caller'],depth:0});
  assert.deepEqual(new Set(r.concepts),new Set(['caller','topic','base']));
  assert.ok(r.items.some(i=>i.node.id==='rule'&&i.category==='applicable'));
  assert.deepEqual(r.grounding.retrieved,['topic']);
  assert.deepEqual(r.grounding.provided,['caller']);
  assert.equal(r.incomplete,false);
  assert.deepEqual(targets(g.get('guide')!.statements,'is'),['document']);
});

test('Japanese body search and code anchors reach Markdown topics', () => {
  const code=typescriptReader.read({rootId:'shared',path:'impl.ts',scope:'shared',text:'function perform() {}\n// @logos-id impl'});
  const g=graph(md('topic','alias "KnowledgeAPI"','知識の検索'),
    md('guide','is document\nabout topic\nimplemented-by impl','日本語の語句を検索する'),code);
  assert.equal(g.search('ＫｎｏｗｌｅｄｇｅＡＰＩ')[0].node.id,'topic');
  assert.ok(g.discover({query:'日本語'}).candidates.some(c=>c.node.id==='topic'));
  const candidate=g.discover({targets:['impl']}).candidates.find(c=>c.node.id==='topic')!;
  assert.deepEqual(candidate.evidence[0].path.map(e=>e.relation),['implemented-by','about']);
  assert.deepEqual(g.search(' \n　'),[]);
});

test('Unchanged persistent indexes avoid parsing; changed and deleted parents invalidate descendants', async t => {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'logos-index-')), cache=path.join(dir,'.logos/index.json');
  let reads=0;
  const reader={...markdownReader,read(input:Parameters<typeof readMarkdown>[0]){reads++;return readMarkdown(input);}};
  const roots=[{id:'docs',path:dir,scope:'shared',include:['.'],role:'knowledge' as const}],index=new KnowledgeIndex(cache);
  t.after(async()=>{index.close();await fs.rm(dir,{recursive:true,force:true});});
  await fs.writeFile(path.join(dir,'parent.md'),mark('parent','','Original condition'));
  await fs.writeFile(path.join(dir,'child.md'),mark('child','is parent'));
  const first=await index.sync(roots,[reader]),count=reads;
  assert.equal(await index.sync(roots,[reader]),first);assert.equal(reads,count);
  index.close();const restarted=new KnowledgeIndex(cache);t.after(()=>restarted.close());
  const loaded=await restarted.sync(roots,[reader]);assert.equal(reads,count);
  assert.equal(loaded.effective('child').definitions[1].content,'# Original condition');
  await fs.writeFile(path.join(dir,'parent.md'),mark('parent','','Changed condition'));
  const updated=await restarted.sync(roots,[reader]);
  assert.equal(updated.effective('child').definitions[1].content,'# Changed condition');
  assert.equal(updated.get('child')!.origin.hash,first.get('child')!.origin.hash);
  await fs.unlink(path.join(dir,'parent.md'));
  assert.ok((await restarted.sync(roots,[reader])).effective('child').diagnostics.some(d=>d.code==='invalid-parent'));
});

test('Context filters act before pagination and task records keep only used concepts', async t => {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'logos-context-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  await fs.mkdir(path.join(dir,'config'));await fs.mkdir(path.join(dir,'knowledge'));
  await fs.writeFile(path.join(dir,'config/logos.json'),JSON.stringify({
    roots:[{id:'docs',path:'.',scope:'shared',include:['knowledge'],role:'knowledge'}],
    plugins:[{module:path.resolve('dist/src/extensions/quality.js')}],contextFilters:['quality.applicability']}));
  await fs.copyFile('knowledge/shared/language.md',path.join(dir,'knowledge/language.md'));
  await fs.writeFile(path.join(dir,'knowledge/topic.md'),mark('topic','governed-by public-documentation','Testsubject'));
  await fs.writeFile(path.join(dir,'knowledge/rule.md'),mark('public-documentation','is criterion','Document public functions'));
  const host=await createHost(dir),task=await host.call('task.create',{objective:'Testsubject'});
  const r=await host.call('knowledge.context',{query:'Testsubject',situation:{publicApi:false},limit:1},{project:'logos',taskId:task.id});
  assert.ok(!r.items.some((i:any)=>i.id==='public-documentation'));
  const recorded=await host.call('task.get',{id:task.id});
  assert.deepEqual(recorded.usedConcepts,['topic']);
  const raw=await host.call('knowledge.get',{id:task.id},{project:'logos'});
  assert.deepEqual(targets(raw.statements,'used-concept'),['topic']);
  assert.deepEqual(targets(raw.statements,'is'),['task']);
  assert.equal('snapshot' in r,false);
});

test('Providers merge ranks, reject hidden IDs and fall back after failure', async t => {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'logos-provider-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  await fs.mkdir(path.join(dir,'config'));await fs.mkdir(path.join(dir,'knowledge'));await fs.mkdir(path.join(dir,'hidden'));
  await fs.writeFile(path.join(dir,'config/logos.json'),JSON.stringify({roots:[
    {id:'docs',path:'.',scope:'shared',include:['knowledge'],role:'knowledge'},
    {id:'hidden',path:'.',scope:'other',include:['hidden'],role:'knowledge'}]}));
  await fs.writeFile(path.join(dir,'knowledge/a.md'),mark('a','','Knowledge'));
  await fs.writeFile(path.join(dir,'knowledge/b.md'),mark('b','','Semantic retrieval'));
  await fs.writeFile(path.join(dir,'hidden/hidden.md'),mark('hidden','','Knowledge'));
  const host=await createHost(dir);
  host.addSearchProvider({id:'semantic',async search(i){assert.deepEqual(i.documents.map(d=>d.id),['a','b']);return [{id:'b',score:1},{id:'hidden',score:99},{id:'invented',score:10}];}});
  host.addSearchProvider({id:'offline',async search(){throw Error('offline');}});
  const r=await host.call('knowledge.search',{query:'Knowledge'});
  assert.deepEqual(new Set(r.items.map((i:any)=>i.id)),new Set(['a','b']));
  assert.ok(r.items.find((i:any)=>i.id==='b').channels.includes('semantic'));
  assert.ok(r.diagnostics.some((d:any)=>d.code==='search-provider-unavailable'));
  await assert.rejects(host.call('knowledge.context',{query:'Knowledge',snapshot:'old'}));
});
});
// @logos-id verify-inheritance-search
