#!/usr/bin/env node
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHost } from './app.js';
async function main() {
  const args = process.argv.slice(2); let workspace = process.cwd(), project: string | undefined, taskId: string | undefined;
  for (let i = 0; i < args.length;) {
    if (args[i] === '--workspace' || args[i] === '--project' || args[i] === '--task') {
      const key = args.splice(i, 1)[0], value = args.splice(i, 1)[0]; if (!value) throw new Error(`Missing value for ${key}`);
      if (key === '--workspace') workspace = path.resolve(value); else if (key === '--project') project = value; else taskId = value;
    } else i++;
  }
  if (!args.length || args[0] === 'help' || args[0] === '--help') {
    console.log('Logos\n  logos [--workspace DIR] [--project ID] [--task ID] operations\n  logos [options] call OPERATION [JSON | @input.json | -]\n\noperations exposes live input/output schemas. Omit input for {}. Use - for JSON on stdin.'); return;
  }
  const host = await createHost(workspace);
  try {
  if (args[0] === 'operations' && args.length === 1) { console.log(JSON.stringify(host.describe(), null, 2)); return; }
  if (args[0] !== 'call' || !args[1] || args.length > 3) throw new Error('Use help for command syntax');
  let raw = args[2] ?? '{}';
  if (raw.startsWith('@')) raw = await fs.readFile(path.resolve(raw.slice(1)), 'utf8');
  else if (raw === '-') { raw = ''; for await (const chunk of process.stdin) raw += chunk; }
  const result = await host.call(args[1], JSON.parse(raw.replace(/^\uFEFF/, '')), { project, taskId });
  console.log(JSON.stringify(result, null, 2));
  } finally { host.close(); }
}
// @logos-id cli
main().catch(error => { console.error(JSON.stringify({ error: error instanceof Error ? error.message : String(error) })); process.exitCode = 1; });
