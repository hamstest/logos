import { z } from 'zod';
import type { Extension } from '../src/host/host.js';
const input = z.object({ members: z.array(z.object({ name: z.string().min(1), public: z.boolean(), description: z.string() })) });
// @logos-id implementation/public-documentation
export function checkDocumentation(value: z.infer<typeof input>) {
  const seen = new Set<string>(), problems: string[] = [];
  for (const member of value.members) {
    if (!member.public) continue;
    if (seen.has(member.name)) problems.push(`Duplicate public member: ${member.name}`);
    seen.add(member.name);
    if (!member.description.trim()) problems.push(`Missing description: ${member.name}`);
  }
  return { outcome: problems.length ? 'failed' as const : 'passed' as const, problems };
}
const extension: Extension = {
  id: 'quality', description: 'Example capability added without changing the host.', requires: ['knowledge'],
  setup(host) {
    host.register({ name: 'quality.documentation', description: 'Check descriptions and duplicate names in supplied public members.', input, output: z.object({ outcome: z.enum(['passed', 'failed']), problems: z.array(z.string()) }), implementationId: 'implementation/public-documentation', handler: checkDocumentation });
    host.register({ name: 'quality.applicability', description: 'Example source-code condition using the current situation.', input: z.object({ query: z.string(), concepts: z.array(z.string()), situation: z.record(z.string(), z.unknown()), candidates: z.array(z.string()) }), output: z.object({ criterion: z.string(), applies: z.enum(['yes', 'no', 'unknown']), reason: z.string() }), handler(i) {
      const publicApi = i.situation.publicApi;
      return { criterion: 'criterion/public-documentation', applies: publicApi === true ? 'yes' : publicApi === false ? 'no' : 'unknown', reason: typeof publicApi === 'boolean' ? 'The caller supplied whether public APIs change.' : 'Public API impact has not been specified.' };
    }});
  },
};
export default extension;
