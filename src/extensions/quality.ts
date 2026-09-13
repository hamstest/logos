import { z } from 'zod';
import type { Extension } from '../host/host.js';
const input = z.object({ members: z.array(z.object({ name: z.string().min(1), public: z.boolean(), description: z.string() })).optional() });
export function checkDocumentation(value: z.infer<typeof input>) {
  const seen = new Set<string>(), problems: string[] = [];
  for (const member of value.members ?? []) {
    if (!member.public) continue;
    if (seen.has(member.name)) problems.push(`Duplicate public member: ${member.name}`);
    seen.add(member.name);
    if (!member.description.trim()) problems.push(`Missing description: ${member.name}`);
  }
  return { outcome: problems.length ? 'failed' as const : 'passed' as const, problems };
}
// @logos-id check-public-documentation
const extension: Extension = {
  id: 'quality', description: 'Validate documentation for registered public operations.', requires: ['knowledge'],
  setup(host) {
    host.register({ name: 'quality.documentation', description: 'Check registered public operation descriptions, or explicitly supplied members.', input, output: z.object({ outcome: z.enum(['passed', 'failed']), problems: z.array(z.string()) }), implementationId: 'check-public-documentation', handler: i => checkDocumentation({ members: i.members ?? host.describe().operations.map(o => ({name:o.name, public:true, description:o.description})) }) });
    host.register({ name: 'quality.applicability', description: 'Select the public documentation criterion for the current change.', input: z.object({ query: z.string(), concepts: z.array(z.string()), situation: z.record(z.string(), z.unknown()), candidates: z.array(z.string()) }), output: z.array(z.object({ id: z.string(), decision: z.enum(['include', 'exclude', 'unknown']), reason: z.string() })), handler(i) {
      const publicApi = i.situation.publicApi;
      return [{ id: 'public-documentation', decision: publicApi === true ? 'include' : publicApi === false ? 'exclude' : 'unknown', reason: typeof publicApi === 'boolean' ? 'The caller supplied whether public APIs change.' : 'Public API impact has not been specified.' }];
    }});
  },
};
export default extension;
