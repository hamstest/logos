// JSON process-protocol example: inspect the selected project without modifying it.
import { readdir } from 'node:fs/promises';
let text = '';
for await (const chunk of process.stdin) text += chunk;
const request = JSON.parse(text);
if (request.protocol !== 1 || request.project.path !== process.cwd()) throw new Error('Invalid invocation');
const files = (await readdir('.')).sort();
process.stdout.write(JSON.stringify({ status: 'completed', summary: `Inspected ${files.length} top-level entries in ${request.project.title}.`, artifacts: [], checks: [{ description: 'Read the selected project directory', outcome: 'passed', evidence: { files, attemptId: request.attemptId } }] }));
