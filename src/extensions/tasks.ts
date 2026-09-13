import { taskSchema, taskResultSchema, readTask, saveTask, allTasks } from '../tasks/store.js';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { projectFor, projects, projectSchema } from '../config.js';
import { containedPath, textOrNull, writeJson } from '../host/files.js';
import type { Extension } from '../host/host.js';
import { idSchema, hash, makeNode, statement, ref } from '../knowledge/model.js';
export const tasks: Extension = {
  implementationId: 'tasks-extension',
  id: 'tasks', description: 'Connect local projects and record objectives, progress, evidence, and outcomes.',
  setup(host) {
    host.addReader({ id: 'task-record', extensions: ['.json'], read(source) {
      try {
        const task = taskSchema.parse(JSON.parse(source.text));
        const span = { start: 0, end: source.text.length };
        return { diagnostics: [], nodes: [makeNode({ ...source, scope: task.project }, {
          id: task.id, statements: [statement('is', ref('task')), ...task.references.map(target => statement('derived-from', ref(target))), ...task.usedConcepts.map(target => statement('used-concept', ref(target)))],
        }, { start: 0, end: 0 }, span, span, task.objective, 'json', 'record')] };
      } catch (error) { return { nodes: [], diagnostics: [{ code: 'invalid-task', message: String(error), rootId: source.rootId, path: source.path }] }; }
    }});

    host.register({ name: 'project.list', description: 'List connected projects, including Logos itself.', input: z.object({}), output: z.array(projectSchema), handler: () => projects(host.workspace) });
    host.register({ name: 'project.connect', description: 'Connect an existing project directory without copying its files.', input: projectSchema, output: projectSchema, async handler(i) {
      if (i.id === 'logos') throw new Error('The built-in Logos project is already connected');
      const absolute = path.resolve(host.workspace, i.path); if (!(await fs.stat(absolute)).isDirectory()) throw new Error('Not a project directory');
      for (const include of i.sources) await containedPath(absolute, include);
      const file = path.join(host.workspace, '.logos/local/projects.json'), before = await textOrNull(file);
      const current = z.array(projectSchema).parse(before ? JSON.parse(before) : []);
      if (current.some(p => p.id === i.id)) throw new Error('Project ID already connected');
      await writeJson(file, [...current, { ...i, path: absolute }], before === null ? null : hash(before)); return i;
    }});
    host.register({ name: 'project.disconnect', description: 'Remove only a project connection; its source files and task history remain.', input: z.object({ id: z.string() }), output: z.object({ disconnected: z.string() }), async handler(i) {
      if (i.id === 'logos') throw new Error('Cannot disconnect the running Logos workspace');
      const file = path.join(host.workspace, '.logos/local/projects.json'), before = await textOrNull(file);
      const current = z.array(projectSchema).parse(before ? JSON.parse(before) : []);
      if (!current.some(p => p.id === i.id)) throw new Error('Unknown project');
      await writeJson(file, current.filter(p => p.id !== i.id), before === null ? null : hash(before)); return { disconnected: i.id };
    }});
    host.register({ name: 'task.create', description: 'Start a task record; knowledge access does not require one.', input: z.object({ objective: z.string().min(1), project: projectSchema.shape.id.optional(), references: z.array(idSchema).default([]), improvement: taskSchema.shape.improvement }), output: taskResultSchema, async handler(i, ctx) {
      const project = i.project ?? ctx.project ?? 'logos'; await projectFor(host.workspace, project);
      const now = new Date().toISOString(); return saveTask(host, taskSchema.parse({ ...i, project, id: 'task-' + randomUUID(), createdAt: now, updatedAt: now }), null);
    }});
    host.register({ name: 'task.get', description: 'Read task progress, verification state and revision for an update.', input: z.object({ id: z.string() }), output: taskResultSchema, handler: (i, ctx) => readTask(host, i.id, ctx.project) });
    host.register({ name: 'task.list', description: 'List tasks in the selected project, or all tasks when no project is selected.', input: z.object({}), output: z.array(taskResultSchema), async handler(_, ctx) { return (await allTasks(host)).filter(t => !ctx.project || t.project === ctx.project); }});
    host.register({ name: 'task.update', description: 'Record direct-agent progress and results. Completion without checks remains unverified.', input: z.object({ id: z.string(), expectedHash: z.string(), status: z.enum(['pending', 'running', 'waiting', 'completed', 'failed', 'cancelled']).optional(), note: z.string().optional(), references: z.array(idSchema).optional(), artifacts: z.array(z.string()).optional(), checks: z.array(z.object({ description: z.string(), outcome: z.enum(['passed', 'failed', 'unverified']), evidence: z.unknown().optional() })).optional(), result: z.string().optional() }), output: taskResultSchema, async handler(i, ctx) {
      const current = await readTask(host, i.id, ctx.project);
      if (current.activeAttempt) throw new Error('Resolve the active execution attempt before editing the task');
      const { id, expectedHash, note, ...patch } = i;
      return saveTask(host, { ...current, ...patch, notes: note ? [...current.notes, note] : current.notes }, expectedHash);
    }});

  },
};
// @logos-id tasks-extension
