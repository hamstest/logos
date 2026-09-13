import { promises as fs } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { projectSchema } from '../config.js';
import type { Host } from '../host/host.js';
import { textOrNull, writeJson } from '../host/files.js';
import { idSchema, hash } from '../knowledge/model.js';
import { graphFor } from '../knowledge/service.js';

export const taskSchema = z.object({
  id: z.string().regex(/^task-[a-f0-9-]+$/), objective: z.string().min(1), project: projectSchema.shape.id,
  status: z.enum(['pending', 'running', 'waiting', 'completed', 'failed', 'cancelled']).default('pending'),
  usedConcepts: z.array(idSchema).default([]), notes: z.array(z.string()).default([]), references: z.array(idSchema).default([]), artifacts: z.array(z.string()).default([]),
  checks: z.array(z.object({ description: z.string(), outcome: z.enum(['passed', 'failed', 'unverified']), evidence: z.unknown().optional() })).default([]),
  result: z.string().optional(), improvement: z.object({ trigger: z.string(), expectedEffect: z.string(), targets: z.array(idSchema) }).optional(),
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
// @logos-id task-store
export async function saveTask(host: Host, task: Task, expected: string | null) {
  const clean = taskSchema.parse({ ...task, updatedAt: new Date().toISOString() });
  await writeJson(taskFile(host, task.id), clean, expected);
  await graphFor(host);
  return readTask(host, task.id);
}
export async function allTasks(host: Host) {
  const dir = path.join(host.workspace, '.logos/tasks');
  const files = await fs.readdir(dir).catch(e => { if (e.code === 'ENOENT') return []; throw e; });
  const result = [];
  for (const file of files.filter(f => /^[a-f0-9-]+\.json$/.test(f))) {
    result.push(await readTask(host, 'task-' + file.slice(0, -5)));
  }
  return result;
}

export const taskResultSchema = taskSchema.extend({ revision: z.string(), verification: z.enum(['passed', 'failed', 'unverified']) });
