import { rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

async function build() {
  const workspace = fileURLToPath(new URL('../', import.meta.url));
  const output = path.resolve(workspace, 'dist');
  if (path.relative(workspace, output) !== 'dist') throw new Error('Build output must be the workspace dist directory');
  await rm(output, { recursive: true, force: true });
  const compiler = path.join(workspace, 'node_modules/typescript/bin/tsc');
  const result = spawnSync(process.execPath, [compiler, '-p', path.join(workspace, 'tsconfig.json')], { cwd: workspace, stdio: 'inherit' });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}
// @logos-id build-workspace

build().catch(error => { console.error(error); process.exitCode = 1; });
