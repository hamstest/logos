import { taskResultSchema } from './tasks.js';
import { changeSchema } from '../knowledge/contracts.js';
import { z } from 'zod';
import type { Extension } from '../host/host.js';
import { readTask } from './tasks.js';
/* @logos
format: 1
id: implementation/improvement-extension
kind: implementation
links:
  - relation: implements
    target: concept/logos-change
  - relation: depends_on
    target: implementation/host
*/
export const improvement: Extension = {
  implementationId: 'implementation/improvement-extension',
  id: 'improvement', description: 'Turn corrections, external ideas and discoveries into tracked improvements and reusable scoped knowledge.', requires: ['knowledge', 'tasks'],
  setup(host) {
    host.register({ name: 'improvement.propose', description: 'Create an improvement task with its trigger, expected effect and target references; implementation and evaluation use normal task operations.', input: z.object({ objective: z.string(), project: z.string().optional(), trigger: z.string(), expectedEffect: z.string(), targets: z.array(z.string()).default([]) }), output: taskResultSchema, handler(i, ctx) {
      return host.call('task.create', { objective: i.objective, project: i.project, references: i.targets, improvement: { trigger: i.trigger, expectedEffect: i.expectedEffect, targets: i.targets } }, ctx);
    }});
    host.register({ name: 'improvement.learn', description: 'Save agent-authored reusable prose with explicit scope, applies_to concepts, and a source task; raw logs are not generalized automatically.', input: z.object({ taskId: z.string(), rootId: z.string(), path: z.string(), id: z.string(), title: z.string(), body: z.string().min(1), concepts: z.array(z.string()).default([]), scope: z.string() }), output: changeSchema, async handler(i, ctx) {
      const task = await readTask(host, i.taskId, ctx.project);
      if (i.scope !== 'shared' && i.scope !== task.project) throw new Error('Learning must be scoped to its project or explicitly shared');
      return host.call('knowledge.create', { rootId: i.rootId, path: i.path, annotation: { format: 1, id: i.id, kind: 'guidance', title: i.title, scope: i.scope, links: [{ relation: 'derived_from', target: task.id }, ...i.concepts.map(target => ({ relation: 'applies_to', target }))] }, body: '# ' + i.title + '\n\n' + i.body }, { project: task.project });
    }});
  },
};
