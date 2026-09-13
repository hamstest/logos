import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHost } from '../dist/src/app.js';
import { graphFor } from '../dist/src/knowledge/service.js';
import { sourceRoots, configuration } from '../dist/src/config.js';

async function auditKnowledge() {
  const workspace = process.cwd();
  const files = [...new Set(execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: workspace, encoding: 'utf8' }).split('\0').filter(Boolean))].sort();
  const host = await createHost(workspace);
  const roots = await sourceRoots(workspace, await configuration(workspace));
  const graph = await graphFor(host);
  const issues = [];
  const registered = new Map();
  const described = new Set();
  for (const node of graph.nodes.values()) {
    const root = roots.find(r => r.id === node.origin.rootId);
    if (root) {
      const file = path.relative(workspace, path.resolve(root.path, node.origin.path)).replaceAll('\\', '/');
      if (!registered.has(file)) registered.set(file, []);
      registered.get(file).push(node.id);
    }
    for (const file of graph.effective(node.id, node.scope).statements.filter(s => s.predicate === 'describes-files').flatMap(s => s.arguments)) {
      if (typeof file === 'string') described.add(file);
    }
  }
  const rows = [];
  for (const file of files) {
    try { await fs.stat(file); } catch (error) {
      if (error.code === 'ENOENT') continue; // A removed tracked file is pending Git staging.
      throw error;
    }
    const reader = host.readers.find(r => r.id !== 'task-record' && r.extensions.includes(path.extname(file).toLowerCase()));
    const ids = registered.get(file) ?? [];
    const expectedScope = file.startsWith('knowledge/shared/') ? 'shared'
      : file.startsWith('knowledge/projects/') ? file.split('/')[2] : 'logos';
    for (const id of ids) if (graph.nodes.get(id)?.scope !== expectedScope) {
      issues.push({ file, problem: 'Unexpected project scope.', id, expectedScope });
    }
    if (reader) {
      if (!ids.length) {
        const projectMatch = /^knowledge\/projects\/([^/]+)\//.exec(file);
        const scope = projectMatch ? projectMatch[1] : 'logos';
        const saved = reader.read({ text: await fs.readFile(file, 'utf8'), path: file, rootId: 'audit', scope });
        if (projectMatch && ['.md', '.markdown'].includes(path.extname(file).toLowerCase()) && !roots.some(r => r.id === scope + '-knowledge') && saved.nodes.length && !saved.diagnostics.length) {
          rows.push({ file, status: 'disconnected-project', ids: saved.nodes.map(n => n.id) });
          continue;
        }
        issues.push({ file, problem: 'No indexed node; check the reader, ID annotation and source root.' });
      } else if (!['.md', '.markdown'].includes(path.extname(file).toLowerCase())) {
        if (!ids.some(id => graph.edges.some(edge => edge.target === id && graph.nodes.get(edge.source)?.origin.language === 'markdown'))) {
          issues.push({ file, problem: 'Source has no incoming relation from Markdown.' });
        }
      }
      rows.push({ file, status: ids.length ? 'indexed' : 'uncovered', ids });
    } else {
      const covered = described.has(file);
      rows.push({ file, status: covered ? 'described-file' : 'uncovered' });
      if (!covered) issues.push({ file, problem: 'No reader or file description.' });
    }
  }
  for (const file of described) if (!rows.some(r => r.file === file)) issues.push({ file, problem: 'Description references a missing or excluded file.' });
  issues.push(...graph.problems('logos'));
  const report = { files: rows.length, indexed: rows.filter(r => r.status === 'indexed').length, described: rows.filter(r => r.status === 'described-file').length, disconnected: rows.filter(r => r.status === 'disconnected-project').length, issues, inventory: rows };
  host.close();
  console.log(JSON.stringify(report, null, 2));
  if (issues.length) process.exitCode = 1;
}
// @logos-id audit-knowledge
auditKnowledge().catch(error => { console.error(error); process.exitCode = 1; });
