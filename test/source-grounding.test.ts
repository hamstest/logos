import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHost } from '../src/app.js';
import { readTypeScript } from '../src/knowledge/typescript.js';
import { hash } from '../src/knowledge/model.js';
const marker = (id: string) => '// @logos-id ' + id + '\n';
const source = (text: string) => ({ rootId: 'source', path: 'source.ts', scope: 'project/sample', text });

async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'logos-grounding-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const workspace = path.join(dir, 'logos'), project = path.join(dir, 'external');
  await fs.mkdir(workspace); await fs.mkdir(project);
  const host = await createHost(workspace);
  await host.call('project.connect', { id: 'project/sample', title: 'Sample', path: project, sources: ['.'] });
  return { host, workspace, project, ctx: { project: 'project/sample' }, root: 'project/sample/knowledge' };
}

test('ID-only anchors have no source-owned semantics and reject misplaced or legacy annotations', () => {
  const node = readTypeScript(source(marker('code/a') + 'function a() {}')).nodes[0];
  assert.equal(node.kind, 'source'); assert.deepEqual(node.links, []);
  assert.deepEqual(node.metadata, { format: 1, id: 'code/a', kind: 'source' });
  for (const text of ['let x = 0; ' + marker('code/a') + 'function a() {}', '// @logos-id code/a extra\nfunction a() {}', marker('code/a') + 'interface I {}\nfunction a() {}']) {
    const result = readTypeScript(source(text)); assert.equal(result.nodes.length, 0); assert.equal(result.diagnostics[0].code, 'invalid-source-anchor');
  }
  const legacy = readTypeScript(source('/* @logos\nformat: 1\nid: code/a\nkind: implementation\nlinks: [{relation: implements, target: criterion/a}]\n*/\nfunction a() {}'));
  assert.equal(legacy.nodes.length, 0); assert.equal(legacy.diagnostics[0].code, 'legacy-source-annotation');
  const statement = readTypeScript(source(marker('test/a') + "describe('group', () => { test('case', () => {}); });\nfunction next() {}"));
  assert.equal(statement.nodes[0].origin.targetKind, 'ExpressionStatement'); assert.ok(!statement.nodes[0].content.includes('function next'));
});

test('Logos Markdown grounds external code in both directions and follows moves without rewriting references', async t => {
  const { host, workspace, project, ctx, root } = await fixture(t);
  const file = path.join(project, 'old.ts'), original = marker('code/refund') + 'export function refund() { return 1; }\n';
  await fs.writeFile(file, original);
  await host.call('knowledge.create', { rootId: root, path: 'refund.md', annotation: { format: 1, id: 'criterion/refund', kind: 'criterion', links: [{ relation: 'implemented_by', target: 'code/refund' }] }, body: '# Refund condition\nCheck the returned value.' }, ctx);
  const mdFile = path.join(workspace, 'knowledge/projects/project%2Fsample/refund.md'), md = await fs.readFile(mdFile, 'utf8');
  assert.equal((await host.call('knowledge.related', { id: 'criterion/refund' }, ctx))[0].target, 'code/refund');
  assert.equal((await host.call('knowledge.related', { id: 'code/refund', direction: 'in' }, ctx))[0].source, 'criterion/refund');
  assert.ok((await host.call('knowledge.context', { concepts: ['code/refund'] }, ctx)).items.some((n: any) => n.id === 'criterion/refund'));
  assert.ok((await host.call('knowledge.context', { query: 'refund' }, ctx)).items.some((n: any) => n.id === 'criterion/refund'));
  await fs.mkdir(path.join(project, 'moved'));
  await fs.writeFile(path.join(project, 'moved/new.ts'), '\n\n' + original.replace('function refund()', 'function renamed()'));
  await fs.unlink(file);
  const moved = await host.call('knowledge.get', { id: 'code/refund' }, ctx);
  assert.equal(moved.title, 'renamed'); assert.equal(moved.origin.path, 'moved/new.ts'); assert.equal(moved.origin.line, 4);
  assert.equal(await fs.readFile(mdFile, 'utf8'), md);
  assert.equal((await host.call('knowledge.get', { id: 'code/refund' }, { project: 'project/logos' })).status, 'unavailable');
  const codeBeforeDelete = await fs.readFile(path.join(project, 'moved/new.ts'), 'utf8');
  const removed = await host.call('knowledge.delete', { id: 'criterion/refund', expectedHash: hash(md) }, ctx);
  assert.equal(await fs.readFile(path.join(project, 'moved/new.ts'), 'utf8'), codeBeforeDelete);
  await host.call('trash.restore', { trashId: removed.id });
  assert.equal((await host.call('knowledge.related', { id: 'code/refund' }, ctx))[0].source, 'criterion/refund');
});

test('External repositories are read-only to knowledge operations and their Markdown is not indexed', async t => {
  const { host, workspace, project, ctx, root } = await fixture(t);
  const externalMarkdown = '```logos\nformat: 1\nid: unwanted\nkind: criterion\n```\n# External note';
  await fs.writeFile(path.join(project, 'README.md'), externalMarkdown);
  const input = { path: 'note.md', annotation: { format: 1, id: 'note', kind: 'guidance' }, body: '# Note\nLocal knowledge.' };
  await assert.rejects(host.call('knowledge.create', { ...input, rootId: 'project/sample/source' }, ctx), /read-only/);
  assert.equal((await host.call('knowledge.get', { id: 'unwanted' }, ctx)).status, 'unavailable');
  await host.call('knowledge.create', { ...input, rootId: root }, ctx);
  await host.call('project.disconnect', { id: ctx.project });
  assert.deepEqual(await fs.readdir(project), ['README.md']); assert.equal(await fs.readFile(path.join(project, 'README.md'), 'utf8'), externalMarkdown);
  assert.ok(await fs.stat(path.join(workspace, 'knowledge/projects/project%2Fsample/note.md')));
  await host.call('project.connect', { id: ctx.project, title: 'Reconnected', path: project, sources: ['.'] });
  assert.equal((await host.call('knowledge.get', { id: 'note' }, ctx)).status, 'available');
});

test('Knowledge roots cannot be configured outside Logos', async t => {
  const { host, workspace, project } = await fixture(t);
  await fs.mkdir(path.join(workspace, 'config'));
  await fs.writeFile(path.join(workspace, 'config/logos.json'), JSON.stringify({ roots: [{ id: 'outside', path: project, scope: 'shared', role: 'knowledge' }] }));
  await assert.rejects(host.call('knowledge.create', { rootId: 'outside', path: 'wrong.md', annotation: { format: 1, id: 'wrong', kind: 'guidance' }, body: '# Wrong' }), /within/);
  assert.deepEqual(await fs.readdir(project), []);
});

test('Deleting or duplicating a source anchor is visible while its Markdown stays intact', async t => {
  const { host, project, ctx, root } = await fixture(t);
  const content = marker('code/unique') + 'function unique() {}';
  await fs.writeFile(path.join(project, 'a.ts'), content);
  await host.call('knowledge.create', { rootId: root, path: 'criterion.md', annotation: { format: 1, id: 'criterion/unique', kind: 'criterion', links: [{ relation: 'implemented_by', target: 'code/unique' }] }, body: '# Criterion' }, ctx);
  await fs.writeFile(path.join(project, 'b.ts'), content);
  assert.ok((await host.call('knowledge.diagnostics', {}, ctx)).some((d: any) => d.code === 'duplicate-id'));
  await fs.unlink(path.join(project, 'b.ts')); await fs.writeFile(path.join(project, 'a.ts'), 'function unique() {}');
  const md = await host.call('knowledge.get', { id: 'criterion/unique' }, ctx);
  assert.equal(md.status, 'available'); assert.equal(md.relations[0].targetStatus, 'unresolved');
});
