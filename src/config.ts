import { promises as fs } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { readJson } from './host/files.js';

export const rootSchema = z.object({ id: z.string().min(1), path: z.string(), scope: z.string().min(1), include: z.array(z.string()).default(['.']) });
export const projectSchema = z.object({ id: z.string().regex(/^project\/[^\s]+$/), path: z.string(), title: z.string(), sources: z.array(z.string()).default(['.']) });
export const runnerSchema = z.object({ id: z.string(), command: z.string(), args: z.array(z.string()).default([]), description: z.string().default(''), timeoutMs: z.number().int().positive().default(300000) });
const configSchema = z.object({
  roots: z.array(rootSchema).default([]),
  plugins: z.array(z.object({ module: z.string(), enabled: z.boolean().default(true), options: z.unknown().optional() })).default([]),
  contextFilters: z.array(z.string()).default([]), runners: z.array(runnerSchema).default([]),
});
export type SourceRoot = z.infer<typeof rootSchema>;
export type Project = z.infer<typeof projectSchema>;
export type Runner = z.infer<typeof runnerSchema>;
export type Config = z.infer<typeof configSchema>;

export async function configuration(workspace: string): Promise<Config> {
  return configSchema.parse(await readJson(path.join(workspace, 'config', 'logos.json'), {}));
}
export async function projects(workspace: string): Promise<Project[]> {
  const self: Project = { id: 'project/logos', path: workspace, title: 'Logos', sources: [] };
  const saved = z.array(projectSchema).parse(await readJson(path.join(workspace, '.logos/local/projects.json'), []));
  return [self, ...saved.filter(p => p.id !== self.id)];
}
export async function projectFor(workspace: string, id?: string) {
  if (!id) return undefined;
  const project = (await projects(workspace)).find(p => p.id === id);
  if (!project) throw new Error(`Unknown project: ${id}`);
  const absolute = path.resolve(workspace, project.path);
  if (!(await fs.stat(absolute)).isDirectory()) throw new Error('Project path is not a directory');
  return { ...project, path: absolute };
}
export async function sourceRoots(workspace: string, config: Config): Promise<SourceRoot[]> {
  const roots = config.roots.map(r => ({ ...r, path: path.resolve(workspace, r.path) }));
  for (const p of await projects(workspace)) if (p.sources.length) roots.push({ id: `${p.id}/source`, path: path.resolve(workspace, p.path), include: p.sources, scope: p.id });
  if (new Set(roots.map(r => r.id)).size !== roots.length) throw new Error('Duplicate source root ID');
  return roots;
}
