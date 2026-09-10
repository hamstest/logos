import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { configuration } from './config.js';
import { Host, type Extension } from './host/host.js';
import { knowledge } from './extensions/knowledge.js';
import { tasks } from './extensions/tasks.js';
import { execution } from './extensions/execution.js';
import { improvement } from './extensions/improvement.js';
export async function createHost(workspace: string): Promise<Host> {
  workspace = path.resolve(workspace);
  const config = await configuration(workspace), host = new Host(workspace);
  const entries: { extension: Extension; entry: string; options?: unknown }[] = [knowledge, tasks, execution, improvement].filter(e => !config.disabledExtensions.includes(e.id)).map(extension => ({ extension, entry: `src/extensions/${extension.id === 'tasks' ? 'tasks' : extension.id}.ts` }));
  for (const plugin of config.plugins.filter(p => p.enabled)) {
    const entry = path.resolve(workspace, plugin.module);
    const module = await import(pathToFileURL(entry).href);
    const extension = module.default as Extension;
    if (!extension?.id || typeof extension.setup !== 'function') throw new Error(`Invalid extension export: ${entry}`);
    entries.push({ extension, entry, options: plugin.options });
  }
  await host.load(entries); return host;
}
