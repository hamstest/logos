import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { stringify } from 'yaml';
import { projectFor, projects, projectSchema } from '../config.js';
import { atomicWrite, containedPath, readJson, textOrNull, writeJson } from '../host/files.js';
import type { Extension, Host } from '../host/host.js';
import { removeFragment } from '../host/trash.js';
import { hash } from '../knowledge/model.js';
export const taskSchema = z.object({
  id: z.string().regex(/^task\/[a-f0-9-]+$/), objective: z.string().min(1), project: z.string(),
  status: z.enum(['pending', 'running', 'waiting', 'completed', 'failed', 'cancelled']).default('pending'),
  notes: z.array(z.string()).default([]), references: z.array(z.string()).default([]), artifacts: z.array(z.string()).default([]),
  checks: z.array(z.object({ description: z.string(), outcome: z.enum(['passed', 'failed', 'unverified']), evidence: z.unknown().optional() })).default([]),
  result: z.string().optional(), improvement: z.object({ trigger: z.string(), expectedEffect: z.string(), targets: z.array(z.string()) }).optional(),
  activeAttempt: z.string().optional(), createdAt: z.string(), updatedAt: z.string(),
});
export type Task = z.infer<typeof taskSchema>;
export const taskFile = (host: Host, id: string) => {
  taskSchema.shape.id.parse(id); return path.join(host.workspace, '.logos/tasks', id.slice(5) + '.json');
};
export async function readTask(host: Host, id: string, project?: string) {
  const text = await textOrNull(taskFile(host, id)); if (!text) throw new Error(`Task unavailable: ${id}`);
  const task = taskSchema.parse(JSON.parse(text));
  if (project && task.project !== project) throw new Error('Task belongs to another project');
  return { ...task, revision: hash(text), verification: task.checks.length ? (task.checks.some(c => c.outcome === 'failed') ? 'failed' : task.checks.every(c => c.outcome === 'passed') ? 'passed' : 'unverified') : 'unverified' };
}
export async function saveTask(host: Host, task: Task, expected: string | null) {
  const clean = taskSchema.parse({ ...task, updatedAt: new Date().toISOString() });
  await writeJson(taskFile(host, task.id), clean, expected);
  return readTask(host, task.id);
}
export async function allTasks(host: Host) {
  const dir = path.join(host.workspace, '.logos/tasks');
  const files = await fs.readdir(dir).catch(e => { if (e.code === 'ENOENT') return []; throw e; });
  const result = [];
  for (const file of files.filter(f => /^[a-f0-9-]+\.json$/.test(f))) {
    if (await textOrNull(path.join(dir, file))) result.push(await readTask(host, 'task/' + file.slice(0, -5)));
  }
  return result;
}
export const tasks: Extension = {
  id: 'tasks', description: 'Connect local projects and record objectives, progress, evidence, and outcomes.',
  setup(host) {
    host.sources.push(async () => (await allTasks(host)).map(task => ({ rootId: 'records', path: task.id + '.md', scope: task.project, text: '```logos\n' + stringify({ format: 1, id: task.id, kind: 'task', attach: 'file', title: task.objective, links: task.references.map(target => ({ relation: 'derived_from', target })) }) + '```\n' + JSON.stringify(task, null, 2) })));
    const output = z.unknown();
    host.register({ name: 'project.list', description: 'List connected projects, including Logos itself.', input: z.object({}), output, handler: () => projects(host.workspace) });
    host.register({ name: 'project.connect', description: 'Connect an existing project directory without copying its files.', input: projectSchema, output, async handler(i) {
      if (i.id === 'project/logos') throw new Error('The built-in Logos project is already connected');
      const absolute = path.resolve(host.workspace, i.path); if (!(await fs.stat(absolute)).isDirectory()) throw new Error('Not a project directory');
      for (const include of i.sources) await containedPath(absolute, include);
      const file = path.join(host.workspace, '.logos/local/projects.json'), before = await textOrNull(file);
      const current = z.array(projectSchema).parse(before ? JSON.parse(before) : []);
      if (current.some(p => p.id === i.id)) throw new Error('Project ID already connected');
      await writeJson(file, [...current, { ...i, path: absolute }], before === null ? null : hash(before)); return i;
    }});
    host.register({ name: 'project.disconnect', description: 'Remove only a project connection; its source files and task history remain.', input: z.object({ id: z.string() }), output, async handler(i) {
      if (i.id === 'project/logos') throw new Error('Cannot disconnect the running Logos workspace');
      const file = path.join(host.workspace, '.logos/local/projects.json'), before = await textOrNull(file);
      const current = z.array(projectSchema).parse(before ? JSON.parse(before) : []);
      if (!current.some(p => p.id === i.id)) throw new Error('Unknown project');
      await writeJson(file, current.filter(p => p.id !== i.id), before === null ? null : hash(before)); return { disconnected: i.id };
    }});
    host.register({ name: 'task.create', description: 'Start a task record; knowledge access does not require one.', input: z.object({ objective: z.string().min(1), project: z.string().optional(), references: z.array(z.string()).default([]), improvement: taskSchema.shape.improvement }), output, async handler(i, ctx) {
      const project = i.project ?? ctx.project ?? 'project/logos'; await projectFor(host.workspace, project);
      const now = new Date().toISOString(); return saveTask(host, taskSchema.parse({ ...i, project, id: 'task/' + randomUUID(), createdAt: now, updatedAt: now }), null);
    }});
    host.register({ name: 'task.get', description: 'Read task progress, verification state and revision for an update.', input: z.object({ id: z.string() }), output, handler: (i, ctx) => readTask(host, i.id, ctx.project) });
    host.register({ name: 'task.list', description: 'List tasks in the selected project, or all tasks when no project is selected.', input: z.object({}), output, async handler(_, ctx) { return (await allTasks(host)).filter(t => !ctx.project || t.project === ctx.project); }});
    host.register({ name: 'task.update', description: 'Record direct-agent progress and results. Completion without checks remains unverified.', input: z.object({ id: z.string(), expectedHash: z.string(), status: taskSchema.shape.status.optional(), note: z.string().optional(), references: z.array(z.string()).optional(), artifacts: z.array(z.string()).optional(), checks: taskSchema.shape.checks.optional(), result: z.string().optional() }), output, async handler(i, ctx) {
      const current = await readTask(host, i.id, ctx.project);
      if (current.activeAttempt) throw new Error('Resolve the active execution attempt before editing the task');
      const { id, expectedHash, note, ...patch } = i;
      return saveTask(host, { ...current, ...patch, notes: note ? [...current.notes, note] : current.notes }, expectedHash);
    }});
    host.register({ name: 'task.delete', description: 'Move a non-running task record to recoverable trash; references are not cascaded.', input: z.object({ id: z.string(), expectedHash: z.string() }), output, async handler(i, ctx) {
      const task = await readTask(host, i.id, ctx.project); if (task.activeAttempt) throw new Error('Cannot delete a task with an unresolved attempt');
      const relative = path.relative(host.workspace, taskFile(host, i.id)), text = (await textOrNull(taskFile(host, i.id)))!;
      return removeFragment(host.workspace, host.workspace, relative, 0, text.length, i.expectedHash, [i.id]);
    }});
  },
};
