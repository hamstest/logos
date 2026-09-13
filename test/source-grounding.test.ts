import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHost as openHost } from '../src/app.js';
import { after } from 'node:test';
const hosts: Awaited<ReturnType<typeof openHost>>[] = [];
const createHost = async (dir: string) => { const host = await openHost(dir); hosts.push(host); return host; };
after(() => { for (const host of hosts) host.close(); });
import { readTypeScript } from '../src/knowledge/typescript.js';
import { hash } from '../src/knowledge/model.js';
const marker = (id: string) => '// @logos-id ' + id + '\n';
const source = (text: string) => ({ rootId: 'source', path: 'source.ts', scope: 'sample', text });

async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'logos-grounding-'));
  t.after(async () => {
    for (const host of hosts) if (host.workspace === path.join(dir, 'logos')) host.close();
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  });
  const workspace = path.join(dir, 'logos'), project = path.join(dir, 'external');
  await fs.mkdir(workspace); await fs.mkdir(project);
  await fs.mkdir(path.join(workspace,'knowledge/shared'),{recursive:true});
  await fs.copyFile('knowledge/shared/language.md',path.join(workspace,'knowledge/shared/language.md'));
  await fs.mkdir(path.join(workspace,'config'));
  await fs.writeFile(path.join(workspace,'config/logos.json'),JSON.stringify({roots:[{id:'shared',path:'.',scope:'shared',include:['knowledge/shared'],role:'knowledge'}]}));
  const host = await createHost(workspace);
  await host.call('project.connect', { id: 'sample', title: 'Sample', path: project, sources: ['.'] });
  return { host, workspace, project, ctx: { project: 'sample' }, root: 'sample-knowledge' };
}

test('ID-only anchors have no source-owned semantics and reject misplaced or legacy annotations', () => {
  const node = readTypeScript(source('function a() {}\n' + marker('code-a'))).nodes[0];
  assert.equal(node.origin.language, 'typescript'); assert.deepEqual(node.statements, []);
  assert.equal(node.id, 'code-a'); assert.equal('metadata' in node, false);
  for (const text of ['let x = 0; ' + marker('code-a') + 'function a() {}', '// @logos-id code-a extra\nfunction a() {}', marker('code-a') + 'interface I {}\nfunction a() {}']) {
    const result = readTypeScript(source(text)); assert.equal(result.nodes.length, 0); assert.equal(result.diagnostics[0].code, 'invalid-source-anchor');
  }
  const legacy = readTypeScript(source('/* @logos\nformat: 2\nid: code-a\nkind: implementation\nlinks: [{relation: implements, target: a}]\n*/\nfunction a() {}'));
  assert.equal(legacy.nodes.length, 0); assert.equal(legacy.diagnostics[0].code, 'legacy-source-annotation');
  const statement = readTypeScript(source("describe('group', () => { test('case', () => {}); });\n" + marker('test-a') + 'function next() {}'));
  assert.equal(statement.nodes[0].origin.targetKind, 'ExpressionStatement'); assert.ok(!statement.nodes[0].content.includes('function next'));
});
// @logos-id verify-source-id-format

test('Logos Markdown grounds external code in both directions and follows moves without rewriting references', async t => {
  const { host, workspace, project, ctx, root } = await fixture(t);
  const file = path.join(project, 'old.ts'), original = 'export function refund() { return 1; }\n' + marker('code-refund');
  await fs.writeFile(file, original);
  await host.call('knowledge.create', { rootId: root, path: 'refund.md', definition: "def refund\n  is criterion\n  implemented-by code-refund\n", body: '# Refund condition\nCheck the returned value.' }, ctx);
  const mdFile = path.join(workspace, 'knowledge/projects/sample/refund.md'), md = await fs.readFile(mdFile, 'utf8');
  assert.equal((await host.call('knowledge.related', { id: 'refund', relation:'implemented-by' }, ctx))[0].target, 'code-refund');
  assert.equal((await host.call('knowledge.related', { id: 'code-refund', direction: 'in' }, ctx))[0].source, 'refund');
  assert.ok((await host.call('knowledge.context', { targets: ['code-refund'] }, ctx)).items.some((n: any) => n.id === 'refund'));
  assert.ok((await host.call('knowledge.context', { query: 'refund' }, ctx)).items.some((n: any) => n.id === 'refund'));
  await fs.mkdir(path.join(project, 'moved'));
  await fs.writeFile(path.join(project, 'moved/new.ts'), '\n\n' + original.replace('function refund()', 'function renamed()'));
  await fs.unlink(file);
  const moved = await host.call('knowledge.get', { id: 'code-refund' }, ctx);
  assert.equal(moved.title, 'renamed'); assert.equal(moved.origin.path, 'moved/new.ts'); assert.equal(moved.origin.line, 3);
  assert.equal(await fs.readFile(mdFile, 'utf8'), md);
  assert.equal((await host.call('knowledge.get', { id: 'code-refund' }, { project: 'logos' })).status, 'unavailable');
  const codeBeforeDelete = await fs.readFile(path.join(project, 'moved/new.ts'), 'utf8');
  await host.call('knowledge.delete', { id: 'refund', expectedHash: hash(md) }, ctx);
  assert.equal(await fs.readFile(path.join(project, 'moved/new.ts'), 'utf8'), codeBeforeDelete);
  assert.equal((await host.call('knowledge.get', { id: 'refund' }, ctx)).status, 'unavailable');
  await fs.writeFile(mdFile, md);
  assert.equal((await host.call('knowledge.related', { id: 'code-refund' }, ctx))[0].source, 'refund');
});
// @logos-id verify-source-grounding

test('External repositories are read-only to knowledge operations and their Markdown is not indexed', async t => {
  const { host, workspace, project, ctx, root } = await fixture(t);
  const externalMarkdown = '# External note\n\n~~~logos\ndef unwanted\n~~~\n';
  await fs.writeFile(path.join(project, 'README.md'), externalMarkdown);
  const input = { path: 'note.md', definition: "def note\n  is document\n", body: '# Note\nLocal knowledge.' };
  await assert.rejects(host.call('knowledge.create', { ...input, rootId: 'sample-source' }, ctx), /read-only/);
  assert.equal((await host.call('knowledge.get', { id: 'unwanted' }, ctx)).status, 'unavailable');
  await host.call('knowledge.create', { ...input, rootId: root }, ctx);
  await host.call('project.disconnect', { id: ctx.project });
  assert.deepEqual(await fs.readdir(project), ['README.md']); assert.equal(await fs.readFile(path.join(project, 'README.md'), 'utf8'), externalMarkdown);
  assert.ok(await fs.stat(path.join(workspace, 'knowledge/projects/sample/note.md')));
  await host.call('project.connect', { id: ctx.project, title: 'Reconnected', path: project, sources: ['.'] });
  assert.equal((await host.call('knowledge.get', { id: 'note' }, ctx)).status, 'available');
});
// @logos-id verify-external-knowledge

test('Knowledge roots cannot be configured outside Logos', async t => {
  const { host, workspace, project } = await fixture(t);
  await fs.mkdir(path.join(workspace, 'config'),{recursive:true});
  await fs.writeFile(path.join(workspace, 'config/logos.json'), JSON.stringify({ roots: [{ id: 'outside', path: project, scope: 'shared', role: 'knowledge' }] }));
  await assert.rejects(host.call('knowledge.create', { rootId: 'outside', path: 'wrong.md', definition: "def wrong\n  is document\n", body: '# Wrong' }), /within/);
  assert.deepEqual(await fs.readdir(project), []);
});
// @logos-id verify-knowledge-root-boundary

test('Deleting or duplicating a source anchor is visible while its Markdown stays intact', async t => {
  const { host, project, ctx, root } = await fixture(t);
  const content = 'function unique() {}\n' + marker('code-unique');
  await fs.writeFile(path.join(project, 'a.ts'), content);
  await host.call('knowledge.create', { rootId: root, path: 'criterion.md', definition: "def source-check\n  is criterion\n  implemented-by code-unique\n", body: '# Criterion' }, ctx);
  await fs.writeFile(path.join(project, 'b.ts'), content);
  assert.ok((await host.call('knowledge.diagnostics', {}, ctx)).some((d: any) => d.code === 'duplicate-id'));
  await fs.unlink(path.join(project, 'b.ts')); await fs.writeFile(path.join(project, 'a.ts'), 'function unique() {}');
  const md = await host.call('knowledge.get', { id: 'source-check' }, ctx);
  assert.equal(md.status, 'available'); assert.equal(md.relations.find((e:any)=>e.relation==='implemented-by').targetStatus, 'unresolved');
});
// @logos-id verify-anchor-conflicts
