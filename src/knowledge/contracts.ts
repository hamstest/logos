import { z } from 'zod';
export const spanSchema = z.object({ start: z.number().int(), end: z.number().int() });
export const originSchema = z.object({ rootId: z.string(), path: z.string(), language: z.string(), hash: z.string(), annotation: spanSchema, content: spanSchema, edit: spanSchema, line: z.number().int(), targetKind: z.string() });
export const diagnosticSchema = z.object({ code: z.string(), message: z.string(), rootId: z.string().optional(), path: z.string().optional(), line: z.number().optional(), scope: z.string().optional(), nodeId: z.string().optional() });
export const edgeSchema = z.object({ source: z.string(), relation: z.string(), target: z.string(), targetStatus: z.enum(['available', 'unresolved', 'out-of-scope', 'deleted']) });
export const operationDescriptionSchema = z.object({ name: z.string(), description: z.string(), extension: z.string(), implementationId: z.string().optional(), input: z.record(z.string(), z.unknown()), output: z.record(z.string(), z.unknown()) });
export const summarySchema = z.object({ id: z.string(), kind: z.string(), title: z.string(), scope: z.string(), summary: z.string(), origin: originSchema, operations: z.array(z.string()) });
export const nodeSchema = z.object({ id: z.string(), kind: z.string(), title: z.string(), scope: z.string(), aliases: z.array(z.string()), content: z.string(), metadata: z.record(z.string(), z.unknown()), origin: originSchema, links: z.array(z.object({ relation: z.string(), target: z.string() })) });
export const contextSchema = z.object({
  items: z.array(summarySchema.extend({ category: z.enum(['applicable', 'concept', 'reference']), reasons: z.array(z.string()) })), total: z.number().int(), nextOffset: z.number().int().nullable(),
  concepts: z.array(z.string()), conceptPaths: z.record(z.string(), z.array(z.string())), ambiguities: z.array(z.object({ name: z.string(), candidates: z.array(z.string()) })),
  diagnostics: z.array(diagnosticSchema), incomplete: z.boolean(), judgments: z.array(z.object({ operation: z.string(), result: z.unknown() })), conditionStatus: z.string(),
});
export const changeSchema = z.object({ id: z.string(), hash: z.string() });
