import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHost as openHost } from '../src/app.js';
import { after } from 'node:test';
const hosts: Awaited<ReturnType<typeof openHost>>[] = [];
const createHost = async (dir: string) => { const host = await openHost(dir); hosts.push(host); return host; };
after(() => { for (const host of hosts) host.close(); });
import { atomicWrite, containedPath } from '../src/host/files.js';
import { insertDefinition } from '../src/knowledge/markdown.js';
import { hash, parseDefinition } from '../src/knowledge/model.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);
import { Host } from '../src/host/host.js';
import { z } from 'zod';
const mark = (id: string, facts = '', body = '# '+id) => insertDefinition(body, parseDefinition('def '+id+'\n'+facts.split('\n').filter(Boolean).map(l=>'  '+l).join('\n')));
async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'logos-test-'));
  t.after(async () => {
    for (const host of hosts) if (host.workspace === dir) host.close();
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  });
  await fs.mkdir(path.join(dir, 'config')); await fs.mkdir(path.join(dir, 'knowledge/shared'), { recursive: true });
  const config = { roots: [{ id: 'shared', path: '.', scope: 'shared', include: ['knowledge/shared'] }], plugins: [] as any[], runners: [] as any[], contextFilters: [] as string[] };
  const saveConfig = () => fs.writeFile(path.join(dir, 'config/logos.json'), JSON.stringify(config));
  await fs.copyFile('knowledge/shared/language.md', path.join(dir, 'knowledge/shared/language.md'));
  await saveConfig(); return { dir, config, saveConfig, host: await createHost(dir) };
}
describe('verify-workflow', () => {
test('Chapter deletion is exact and conflict-aware; Git restores the original and refreshes the index', async t => {
  const { dir, host } = await fixture(t);
  const text = mark('a', '', '# A\nText\n') + mark('child', '', '## Child\nBody\n') + mark('b', '', '# B\nUntouched\n');
  const file = path.join(dir, 'knowledge/shared/test.md'); await fs.writeFile(file, text);
  await exec('git', ['init', '--quiet'], { cwd: dir });
  await exec('git', ['add', '--', 'knowledge/shared/test.md'], { cwd: dir });
  await exec('git', ['-c', 'user.name=Logos test', '-c', 'user.email=logos-test@localhost', '-c', 'commit.gpgSign=false', 'commit', '--quiet', '-m', 'Record the original'], { cwd: dir });
  const preview = await host.call('knowledge.deletePreview', { id: 'a' });
  assert.deepEqual(preview.affectedIds, ['a', 'child']);
  await assert.rejects(host.call('knowledge.delete', { id: 'a', expectedHash: 'stale' }), /conflict/);
  const removed = await host.call('knowledge.delete', { id: 'a', expectedHash: preview.expectedHash });
  assert.equal(await fs.readFile(file, 'utf8'), mark('b', '', '# B\nUntouched\n'));
  assert.deepEqual(removed.affectedIds, preview.affectedIds);
  assert.equal(removed.hash, hash(await fs.readFile(file, 'utf8')));
  assert.deepEqual(await host.call('knowledge.get', { id: 'a' }), { id: 'a', status: 'unavailable' });
  assert.equal((await host.call('knowledge.get', { id: 'child' })).status, 'unavailable');
  assert.equal((await host.call('knowledge.get', { id: 'b' })).status, 'available');
  await assert.rejects(fs.stat(path.join(dir, '.logos/trash')), { code: 'ENOENT' });
  await exec('git', ['-c', 'core.autocrlf=false', 'restore', '--source=HEAD', '--worktree', '--', 'knowledge/shared/test.md'], { cwd: dir });
  assert.equal((await host.call('knowledge.get', { id: 'a' })).status, 'available');
  assert.equal((await host.call('knowledge.get', { id: 'child' })).status, 'available');
  assert.equal(await fs.readFile(file, 'utf8'), text);
  const edited = await host.call('knowledge.update', { id: 'child', expectedHash: hash(text), body: '## Child\nRevised' });
  assert.notEqual(edited.hash, hash(text));
  assert.ok((await fs.readFile(file, 'utf8')).endsWith(mark('b', '', '# B\nUntouched\n')));
  await assert.rejects(host.call('knowledge.update', { id: 'a', expectedHash: edited.hash, body: '# A\nWould remove child' }), /lose/);
});
test('A blocked deletion preserves the original without creating recovery records', async t => {
  const { dir, host } = await fixture(t); const file = path.join(dir, 'knowledge/shared/a.md'), text = mark('a', '', '# A\n');
  await fs.writeFile(file, text); await fs.writeFile(file + '.logos-lock', 'simulate interrupted writer');
  await assert.rejects(host.call('knowledge.delete', { id: 'a', expectedHash: hash(text) }), /writer/);
  assert.equal(await fs.readFile(file, 'utf8'), text);
  await assert.rejects(fs.stat(path.join(dir, '.logos/trash')), { code: 'ENOENT' });
});
test('Atomic creation and updates reject collisions, stale writes, and path traversal', async t => {
  const { dir } = await fixture(t), file = path.join(dir, 'x.txt');
  await atomicWrite(file, 'one', null); await assert.rejects(atomicWrite(file, 'two', null), /conflict/);
  const results = await Promise.allSettled([atomicWrite(file, 'two', hash('one')), atomicWrite(file, 'three', hash('one'))]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  await assert.rejects(containedPath(dir, '../outside'), /within/);
});
test('Plugin registry exposes the same validated operations it dispatches, including disable and dependencies', async t => {
  const { dir, config, saveConfig } = await fixture(t);
  const pluginPath = path.resolve('dist/src/extensions/quality.js');
  config.plugins.push({ module: pluginPath, enabled: true }); await saveConfig();
  let host = await createHost(dir);
  assert.equal((await host.call('quality.documentation', {})).outcome, 'passed');
  assert.ok(host.describe().operations.some(o => o.name === 'quality.documentation' && o.implementationId === 'check-public-documentation'));
  assert.equal((await host.call('quality.documentation', { members: [{ name: 'x', public: true, description: '' }] })).outcome, 'failed');
  await assert.rejects(host.call('quality.documentation', { members: 'wrong' }));
  config.plugins[0].enabled = false; await saveConfig(); host = await createHost(dir);
  assert.ok(!host.describe().operations.some(o => o.name.startsWith('quality.')));
  await assert.rejects(host.call('quality.documentation', { members: [] }), /disabled/);
  const h = new Host(dir); await assert.rejects(h.load([{ extension: { id: 'bad', description: '', requires: ['missing'], setup() {} }, entry: 'test' }]), /dependencies/);
  const bad = new Host(dir); await bad.load([{ extension: { id: 'bad-output', description: '', setup(h) { h.register({ name: 'bad', description: '', input: z.object({}), output: z.string(), handler: () => 42 }); } }, entry: 'test' }]);
  await assert.rejects(bad.call('bad', {}));
});
test('Direct work, learning, project isolation and retained task records form a complete flow', async t => {
  const { dir, host } = await fixture(t); const project = path.join(dir, 'project'); await fs.mkdir(project);
  await fs.writeFile(path.join(dir, 'knowledge/shared/concept.md'), mark('topic', '', '# Topic'));
  await host.call('project.connect', { id: 'demo', title: 'Demo', path: project, sources: ['.'] });
  const task = await host.call('task.create', { objective: 'Fix a repeated mistake', project: 'demo' });
  const done = await host.call('task.update', { id: task.id, expectedHash: task.revision, status: 'completed', note: 'Correction observed', result: 'Changed the procedure' });
  assert.equal(done.verification, 'unverified');
  await assert.rejects(host.call('improvement.learn', {taskId:task.id, rootId:'shared', path:'wrong-scope.md', id:'wrong', title:'Wrong scope', body:'Must not save', scope:'demo'}), /scope/);
  await host.call('improvement.learn', { taskId: task.id, rootId: 'demo-knowledge', path: 'lesson.md', id: 'lesson', title: 'Lesson', body: 'Check the input before proceeding.', concepts: ['topic'], scope: 'demo' });
  const context = await host.call('knowledge.context', { concepts: ['topic'] }, { project: 'demo' });
  assert.ok(context.items.some((n: any) => n.id === 'lesson' && n.category === 'applicable'));
  assert.ok(!(await host.call('knowledge.context', { concepts: ['topic'] })).items.some((n: any) => n.id === 'lesson'));
  assert.ok((await host.call('knowledge.related', { id: task.id }, { project: 'demo' })).some((e: any) => e.source === 'lesson'));
  const operations = host.describe().operations.map(o => o.name);
  assert.ok(!operations.includes('task.delete'));
  assert.ok(!operations.some(name => name.startsWith('trash.')));
  assert.equal((await host.call('knowledge.get', { id: task.id }, { project: 'demo' })).status, 'available');
  const cancelled = await host.call('task.create', { objective: 'Work no longer needed', project: 'demo' });
  await host.call('task.update', { id: cancelled.id, expectedHash: cancelled.revision, status: 'cancelled' });
  assert.equal((await host.call('task.get', { id: cancelled.id })).status, 'cancelled');
  assert.equal((await host.call('task.get', { id: task.id })).result, done.result);
  await host.call('project.disconnect', { id: 'demo' });
  assert.ok(await fs.stat(path.join(dir, 'knowledge/projects/demo/lesson.md')));
  assert.equal((await host.call('task.get', { id: task.id })).result, done.result);
  assert.deepEqual(await fs.readdir(project), []);
});
test('Process delegation records real results and requires reconciliation after invalid output', async t => {
  const { dir, host: initial, config, saveConfig } = await fixture(t);
  config.runners.push({ id: 'inventory', command: process.execPath, args: [path.resolve('scripts/inventory-runner.mjs')], timeoutMs: 10000 });
  config.runners.push({ id: 'invalid', command: process.execPath, args: ['-e', "console.log('not-json')"], timeoutMs: 10000 });
  await saveConfig(); const host = await createHost(dir);
  const task = await host.call('task.create', { objective: 'Inventory project' });
  const unchanged = await host.call('task.get', { id: task.id });
  assert.equal(unchanged.revision, task.revision);
  assert.equal(unchanged.activeAttempt, undefined);
  const run = await host.call('execution.run', { taskId: task.id, runnerId: 'inventory' });
  assert.equal(run.task.status, 'completed'); assert.equal(run.task.verification, 'passed'); assert.equal(run.task.activeAttempt, undefined);
  const broken = await host.call('task.create', { objective: 'Interrupted work' });
  const unknown = await host.call('execution.run', { taskId: broken.id, runnerId: 'invalid' });
  assert.equal(unknown.attempt.state, 'unknown'); assert.equal(unknown.task.status, 'waiting');
  await assert.rejects(host.call('execution.run', { taskId: broken.id, runnerId: 'inventory' }), /unresolved/);
  const restarted = await createHost(dir);
  await assert.rejects(restarted.call('execution.run', { taskId: broken.id, runnerId: 'inventory' }), /unresolved/);
  await restarted.call('execution.reconcile', { taskId: broken.id, attemptId: unknown.attempt.id, runnerStopped: true, status: 'failed', summary: 'Process exited with invalid output; inspected effects' });
  assert.equal((await restarted.call('execution.run', { taskId: broken.id, runnerId: 'inventory' })).task.status, 'completed');
});
test('Registered code evaluations are recorded with implementation references on improvement tasks', async t => {
  const { dir, config, saveConfig } = await fixture(t); config.plugins.push({ module: path.resolve('dist/src/extensions/quality.js') }); config.contextFilters.push('quality.applicability'); await saveConfig();
  const host = await createHost(dir);
  const task = await host.call('improvement.propose', { objective: 'Improve capability documentation', trigger: 'A missing explanation', expectedEffect: 'Users can discover operation purpose', targets: ['check-public-documentation'] });
  const evaluated = await host.call('execution.evaluate', { taskId: task.id, operation: 'quality.documentation', input: { members: [{ name: 'example', public: true, description: 'A useful example' }] } });
  assert.equal(evaluated.checks[0].outcome, 'passed'); assert.ok(evaluated.references.includes('check-public-documentation'));
  assert.equal((await host.call('knowledge.context', { situation: {} })).judgments[0].result[0].decision, 'unknown');
  assert.equal((await host.call('knowledge.context', { situation: { publicApi: false } })).judgments[0].result[0].decision, 'exclude');
});

test('Workspace configuration accepts UTF-8 BOM from PowerShell editors', async t => {
  const { dir } = await fixture(t);
  const file = path.join(dir, 'config/logos.json'); await fs.writeFile(file, '\uFEFF' + await fs.readFile(file, 'utf8'));
  assert.ok((await createHost(dir)).describe().operations.length > 0);
});

test('Transient replacement retries preserve concurrent-edit protection', async t => {
  const { replaceChecked } = await import('../src/host/files.js');
  const { dir } = await fixture(t), file = path.join(dir, 'original'), temp = path.join(dir, 'replacement');
  await fs.writeFile(file, 'before'); await fs.writeFile(temp, 'after');
  let tries = 0;
  await replaceChecked(temp, file, hash('before'), async (from, to) => { if (tries++ === 0) throw Object.assign(new Error('temporary lock'), { code: 'EPERM' }); await fs.rename(from, to); });
  assert.equal(await fs.readFile(file, 'utf8'), 'after'); assert.equal(tries, 2);
  await fs.writeFile(temp, 'unsafe');
  await assert.rejects(replaceChecked(temp, file, hash('after'), async () => { await fs.writeFile(file, 'concurrent'); throw Object.assign(new Error('temporary lock'), { code: 'EPERM' }); }), /conflict/);
  assert.equal(await fs.readFile(file, 'utf8'), 'concurrent'); assert.equal(await fs.readFile(temp, 'utf8'), 'unsafe');
});

test('Timed-out process attempts return unknown and do not auto-retry', async t => {
  const { dir, config, saveConfig } = await fixture(t);
  config.runners.push({ id: 'slow', command: process.execPath, args: ['-e', 'setTimeout(() => {}, 10000)'], timeoutMs: 100 }); await saveConfig();
  const host = await createHost(dir), task = await host.call('task.create', { objective: 'Timeout example' });
  const result = await host.call('execution.run', { taskId: task.id, runnerId: 'slow' });
  assert.equal(result.attempt.state, 'unknown'); assert.match(result.attempt.error, /timed out/);
  await assert.rejects(host.call('execution.run', { taskId: task.id, runnerId: 'slow' }), /unresolved/);
});

test('A note-only task update preserves completion and existing checks', async t => {
  const { host } = await fixture(t);
  const task = await host.call('task.create', { objective: 'Keep prior result' });
  const done = await host.call('task.update', { id: task.id, expectedHash: task.revision, status: 'completed', checks: [{ description: 'Verified', outcome: 'passed' }] });
  const noted = await host.call('task.update', { id: task.id, expectedHash: done.revision, note: 'A later observation' });
  assert.equal(noted.status, 'completed'); assert.equal(noted.verification, 'passed'); assert.equal(noted.checks.length, 1);
});

test('Overlapping source roots produce a visible configuration problem', async t => {
  const { dir, config, saveConfig } = await fixture(t);
  await fs.writeFile(path.join(dir, 'knowledge/shared/a.md'), mark('a', '', '# A'));
  config.roots.push({ id: 'duplicate', path: '.', scope: 'logos', include: ['knowledge/shared'] }); await saveConfig();
  const host = await createHost(dir);
  assert.ok((await host.call('knowledge.diagnostics', {}, { project: 'logos' })).some((d: any) => d.code === 'overlapping-root'));
});

test('CLI exposes live schemas, accepts JSON input and fails visibly on unavailable operations', async t => {
  const { dir } = await fixture(t);
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util'); const exec = promisify(execFile);
  const cli = path.resolve('dist/src/cli.js');
  const listing = JSON.parse((await exec(process.execPath, [cli, '--workspace', dir, 'operations'])).stdout);
  assert.ok(listing.operations.find((o: any) => o.name === 'task.get').output.properties.revision);
  assert.ok(listing.operations.find((o: any) => o.name === 'knowledge.context').output.properties.nextOffset);
  const task = JSON.parse((await exec(process.execPath, [cli, '--workspace', dir, 'call', 'task.create', JSON.stringify({ objective: 'Unicode task: 確認' })])).stdout);
  assert.equal(task.objective, 'Unicode task: 確認');
  await assert.rejects(exec(process.execPath, [cli, '--workspace', dir, 'call', 'missing', '{}']), (error: any) => error.code === 1 && JSON.parse(error.stderr).error.includes('Unknown'));
});

test('Flat project and knowledge IDs create readable paths and reject slash IDs at API boundaries', async t => {
  const {dir,host}=await fixture(t),project=path.join(dir,'connected');
  await fs.mkdir(project);
  for(const id of ['project/old','old%2Fname','shared'])await assert.rejects(host.call('project.connect',{id,title:'Invalid',path:project,sources:['.']}));
  await host.call('project.connect',{id:'connected-project',title:'Connected',path:project,sources:['.']});
  const input={rootId:'connected-project-knowledge',path:'guide.md',definition:'def connected-guide\n  is document, knowledge\n',body:'# Connected guide\nDescription before its definition.'};
  await host.call('knowledge.create',input,{project:'connected-project'});
  const saved=await fs.readFile(path.join(dir,'knowledge/projects/connected-project/guide.md'),'utf8');
  assert.ok(saved.indexOf('Description before')<saved.indexOf('~~~logos'));
  assert.match(saved,/is document, knowledge/);
  assert.ok(!saved.includes('%2F'));
  await assert.rejects(host.call('knowledge.create',{...input,path:'invalid.md',definition:'def invalid/id\n'},{project:'connected-project'}));
  await assert.rejects(host.call('knowledge.context',{concepts:['invalid/id']},{project:'connected-project'}));
  await assert.rejects(host.call('knowledge.get',{id:'invalid/id'},{project:'connected-project'}));
  assert.deepEqual(await fs.readdir(path.join(dir,'knowledge/projects/connected-project')),['guide.md']);
  assert.deepEqual(await fs.readdir(project),[]);
});

test('Deleted targets become unresolved without modifying the referring original', async t => {
  const { dir, host } = await fixture(t);
  const original = mark('target', '', '# Target'); await fs.writeFile(path.join(dir, 'knowledge/shared/target.md'), original);
  await fs.writeFile(path.join(dir, 'knowledge/shared/referrer.md'), mark('referrer', 'depends-on target', '# Referrer'));
  const referrerFile = path.join(dir, 'knowledge/shared/referrer.md');
  const referrerBefore = await fs.readFile(referrerFile, 'utf8');
  await host.call('knowledge.delete', { id: 'target', expectedHash: hash(original) });
  assert.equal(await fs.readFile(referrerFile, 'utf8'), referrerBefore);
  assert.equal((await host.call('knowledge.related', { id: 'referrer' }))[0].targetStatus, 'unresolved');
  assert.equal((await host.call('knowledge.get', { id: 'referrer' })).relations[0].targetStatus, 'unresolved');
});

});
// @logos-id verify-workflow
