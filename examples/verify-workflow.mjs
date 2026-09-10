// Run after npm run build. Creates local demo records under .logos; no external agent is called.
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { createHost } from '../dist/src/app.js';
const workspace = process.cwd(), host = await createHost(workspace);
const project = 'project/example', directory = path.join(workspace, '.logos/example-project');
await mkdir(directory, { recursive: true });
if (!(await host.call('project.list')).some(p => p.id === project)) await host.call('project.connect', { id: project, title: 'Local workflow example', path: directory, sources: ['.'] });
const ctx = { project };
if ((await host.call('knowledge.get', { id: 'concept/project-inspection' }, ctx)).status !== 'available') {
  await host.call('knowledge.create', { rootId: project + '/source', path: 'inspection.md', annotation: { format: 1, id: 'concept/project-inspection', kind: 'concept', title: 'Project inspection' }, body: '# Project inspection\nRead and describe the selected project.' }, ctx);
}
const refund = await host.call('knowledge.context', { concepts: ['concept/refund'] }, ctx);
assert.ok(refund.items.some(x => x.id === 'criterion/reconciliation' && x.category === 'applicable'));
assert.ok(refund.items.some(x => x.id === 'criterion/retry-awareness' && x.category === 'applicable'));
const task = await host.call('task.create', { objective: 'Inspect the connected project directory', project });
const run = await host.call('execution.run', { taskId: task.id, runnerId: 'local-inventory', concepts: ['concept/project-inspection'] }, ctx);
assert.equal(run.task.status, 'completed');
assert.equal(run.task.verification, 'passed');
const lessonId = 'guidance/inspection-' + task.id.slice(5);
await host.call('improvement.learn', { taskId: task.id, rootId: project + '/source', path: task.id.slice(5) + '-lesson.md', id: lessonId, title: 'Inspect the selected directory', body: 'Use the connected project directory as the working directory when collecting its entries. This run verified the selected directory, not the behavior of an autonomous agent.', concepts: ['concept/project-inspection'], scope: project }, ctx);
assert.ok((await host.call('knowledge.context', { concepts: ['concept/project-inspection'] }, ctx)).items.some(x => x.id === lessonId));
assert.ok(!(await host.call('knowledge.context', { concepts: ['concept/project-inspection'] }, { project: 'project/logos' })).items.some(x => x.id === lessonId));
const criterion = await host.call('knowledge.related', { id: 'criterion/public-documentation' }, { project: 'project/logos' });
assert.ok(criterion.some(edge => edge.source === 'implementation/public-documentation'));
const implementation = await host.resolve('implementation/public-documentation', { project: 'project/logos' });
assert.ok(implementation.operations.some(op => op.name === 'quality.documentation'));
assert.ok(implementation.relations.some(edge => edge.target === 'criterion/public-documentation'));
const report = { taskId: task.id, status: run.task.status, verification: run.task.verification, learnedId: lessonId, inheritedCriteria: refund.items.filter(x => x.category === 'applicable').map(x => x.id), extensions: host.describe().extensions.map(e => e.id), operationCount: host.describe().operations.length, diagnostics: await host.call('knowledge.diagnostics', {}, { project: 'project/logos' }) };
assert.deepEqual(report.diagnostics, []);
await writeFile(path.join(workspace, '.logos/workflow-report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
