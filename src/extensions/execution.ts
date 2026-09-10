import { spawn } from 'node:child_process';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { configuration, projectFor, type Runner } from '../config.js';
import { readJson, writeJson } from '../host/files.js';
import type { Extension } from '../host/host.js';
import { readTask, saveTask } from './tasks.js';
const responseSchema = z.object({ status: z.enum(['completed', 'failed', 'waiting']), summary: z.string(), artifacts: z.array(z.string()).default([]), checks: z.array(z.object({ description: z.string(), outcome: z.enum(['passed', 'failed', 'unverified']), evidence: z.unknown().optional() })).default([]) });
/* @logos
format: 1
id: implementation/run-process
kind: implementation
links:
  - relation: implements
    target: criterion/explicit-execution
*/
export async function runProcess(runner: Runner, cwd: string, payload: unknown): Promise<z.infer<typeof responseSchema>> {
  return new Promise((resolve, reject) => {
    const child = spawn(runner.command, runner.args, { cwd, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', bytes = 0, reason: string | undefined;
    const timer = setTimeout(() => { reason = 'Execution timed out; external effects may have occurred'; child.kill(); }, runner.timeoutMs);
    child.stdout.on('data', chunk => { bytes += Buffer.byteLength(chunk); if (bytes > 2_000_000) { reason = 'Runner output exceeded 2 MB'; child.kill(); } else stdout += chunk; });
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-16000); });
    child.stdin.on('error', () => {});
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => {
      clearTimeout(timer);
      if (reason) return reject(new Error(reason));
      if (code !== 0) return reject(new Error(`Runner exited ${code}: ${stderr}`));
      try { resolve(responseSchema.parse(JSON.parse(stdout))); } catch (e) { reject(new Error(`Invalid runner JSON: ${String(e)}; stderr: ${stderr}`)); }
    });
    child.stdin.end(JSON.stringify(payload) + '\n');
  });
}
export const execution: Extension = {
  id: 'execution', description: 'Delegate tasks through a configured JSON process adapter; preserve attempts before launching.', requires: ['knowledge', 'tasks'],
  setup(host) {
    const output = z.unknown();
    host.register({ name: 'execution.runners', description: 'List explicitly configured process adapters.', input: z.object({}), output, async handler() { return (await configuration(host.workspace)).runners; }});
    host.register({ name: 'execution.run', description: 'Delegate once in the task project directory. Interrupted or invalid responses require reconciliation, never automatic retry.', implementationId: 'implementation/run-process', input: z.object({ taskId: z.string(), runnerId: z.string(), concepts: z.array(z.string()).default([]), situation: z.record(z.string(), z.unknown()).default({}) }), output, async handler(i, ctx) {
      const task = await readTask(host, i.taskId, ctx.project);
      if (task.activeAttempt) throw new Error('Previous attempt is unresolved; inspect and reconcile it before retrying');
      if (['completed', 'cancelled'].includes(task.status)) throw new Error('Reopen the task explicitly before executing again');
      const runner = (await configuration(host.workspace)).runners.find(r => r.id === i.runnerId); if (!runner) throw new Error('Unknown runner');
      const project = (await projectFor(host.workspace, task.project))!;
      const context = await host.call('knowledge.context', { query: task.objective, concepts: i.concepts, situation: i.situation }, { project: task.project });
      const id = randomUUID(), file = path.join(host.workspace, '.logos/attempts', id + '.json');
      const attempt = { id, taskId: task.id, runnerId: runner.id, state: 'prepared', startedAt: new Date().toISOString(), context, result: undefined as unknown, error: undefined as string | undefined };
      await writeJson(file, attempt, null);
      // Claim the task using its revision before starting a process: concurrent starts cannot both win.
      await saveTask(host, { ...task, status: 'running', activeAttempt: id }, task.revision);
      try {
        attempt.state = 'running'; await writeJson(file, attempt);
        const resolvedRunner = { ...runner, command: runner.command.replaceAll('${workspace}', host.workspace), args: runner.args.map(arg => arg.replaceAll('${workspace}', host.workspace)) };
        const result = await runProcess(resolvedRunner, project.path, { protocol: 1, attemptId: id, task, project, context, situation: i.situation });
        attempt.result = result; attempt.state = result.status; await writeJson(file, attempt);
        const current = await readTask(host, task.id);
        if (current.activeAttempt !== id) throw new Error('Attempt ownership changed; reconcile persisted results');
        const { activeAttempt, ...rest } = current;
        const saved = await saveTask(host, { ...rest, status: result.status, result: result.summary, artifacts: [...current.artifacts, ...result.artifacts], checks: [...current.checks, ...result.checks], references: [...new Set([...current.references, ...context.items.map((n: { id: string }) => n.id)])] }, current.revision);
        return { attempt, task: saved };
      } catch (error) {
        attempt.state = 'unknown'; attempt.error = String(error); await writeJson(file, attempt);
        const current = await readTask(host, task.id);
        if (current.activeAttempt === id) await saveTask(host, { ...current, status: 'waiting', notes: [...current.notes, `Attempt ${id} needs reconciliation: ${String(error)}`] }, current.revision);
        return { attempt, task: await readTask(host, task.id) };
      }
    }});
    host.register({ name: 'execution.inspect', description: 'Inspect an attempt. Persisted running state after interruption does not prove that a process is still alive.', input: z.object({ attemptId: z.string().uuid() }), output, async handler(i, ctx) {
      const attempt: any = await readJson(path.join(host.workspace, '.logos/attempts', i.attemptId + '.json'), null); if (!attempt) throw new Error('Attempt not found');
      await readTask(host, attempt.taskId, ctx.project); return attempt;
    }});
    host.register({ name: 'execution.reconcile', description: 'Manually record an observed outcome after confirming the runner has stopped; release the attempt for explicit retry.', input: z.object({ taskId: z.string(), attemptId: z.string().uuid(), status: z.enum(['completed', 'failed', 'waiting', 'cancelled']), summary: z.string().min(1), runnerStopped: z.literal(true) }), output, async handler(i, ctx) {
      const task = await readTask(host, i.taskId, ctx.project);
      if (task.activeAttempt !== i.attemptId) throw new Error('This is not the active attempt');
      const file = path.join(host.workspace, '.logos/attempts', i.attemptId + '.json');
      const attempt: any = await readJson(file, null); if (!attempt || attempt.taskId !== task.id) throw new Error('Attempt record mismatch');
      await writeJson(file, { ...attempt, state: i.status, reconciliation: { summary: i.summary, observedAt: new Date().toISOString() } });
      const { activeAttempt, ...rest } = task;
      return saveTask(host, { ...rest, status: i.status, result: i.summary }, task.revision);
    }});
    host.register({ name: 'execution.evaluate', description: 'Call a registered criterion implementation and append its reported evidence to a task.', input: z.object({ taskId: z.string(), operation: z.string(), input: z.unknown() }), output, async handler(i, ctx) {
      const task = await readTask(host, i.taskId, ctx.project); if (task.activeAttempt) throw new Error('Resolve active execution before evaluation');
      if (i.operation.startsWith('execution.')) throw new Error('Select a criterion operation');
      const definition = host.describe().operations.find(op => op.name === i.operation); if (!definition) throw new Error('Unknown evaluation operation');
      const result = await host.call(i.operation, i.input, { project: task.project, taskId: task.id });
      const reported = result?.outcome; const outcome = ['passed', 'failed', 'unverified'].includes(reported) ? reported as 'passed' | 'failed' | 'unverified' : 'unverified';
      return saveTask(host, { ...task, checks: [...task.checks, { description: i.operation, outcome, evidence: result }], references: [...new Set([...task.references, ...(definition.implementationId ? [definition.implementationId] : [])])] }, task.revision);
    }});
  },
};
