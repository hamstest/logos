import { configuration, sourceRoots } from '../config.js';
import { idSchema, serializeDefinition, statement, ref } from '../knowledge/model.js';
import { taskResultSchema } from '../tasks/store.js';
import { changeSchema } from '../knowledge/contracts.js';
import { z } from 'zod';
import type { Extension } from '../host/host.js';
import { readTask } from '../tasks/store.js';
export const improvement: Extension = {
  implementationId: 'improvement-extension',
  id: 'improvement', description: 'Turn corrections, external ideas and discoveries into tracked improvements and reusable scoped knowledge.', requires: ['knowledge', 'tasks'],
  setup(host) {
    host.register({ name: 'improvement.propose', description: 'Create an improvement task with its trigger, expected effect and target references; implementation and evaluation use normal task operations.', input: z.object({ objective: z.string(), project: idSchema.optional(), trigger: z.string(), expectedEffect: z.string(), targets: z.array(idSchema).default([]) }), output: taskResultSchema, handler(i, ctx) {
      return host.call('task.create', { objective: i.objective, project: i.project, references: i.targets, improvement: { trigger: i.trigger, expectedEffect: i.expectedEffect, targets: i.targets } }, ctx);
    }});
    host.register({ name: 'improvement.learn', description: 'Save agent-authored reusable prose with explicit scope, about concepts, and a source task; raw logs are not generalized automatically.', input: z.object({ taskId: z.string(), rootId: z.string(), path: z.string(), id: idSchema, title: z.string(), body: z.string().min(1), concepts: z.array(idSchema).default([]), scope: z.string() }), output: changeSchema, async handler(i, ctx) {
      const task = await readTask(host, i.taskId, ctx.project);
      if (i.scope !== 'shared' && i.scope !== task.project) throw new Error('Learning must be scoped to its project or explicitly shared');
      const root = (await sourceRoots(host.workspace, await configuration(host.workspace))).find(r => r.id === i.rootId);
      if (root?.scope !== i.scope) throw new Error('Learning scope must match the selected knowledge root');
      return host.call('knowledge.create', { rootId: i.rootId, path: i.path, definition: serializeDefinition({id:i.id, statements:[statement('is',ref('document')), statement('derived-from',ref(task.id)), ...i.concepts.map(target=>statement('about',ref(target)))]}), body: '# ' + i.title + '\n\n' + i.body }, { project: task.project });
    }});
  },
};
// @logos-id improvement-extension
