import { idSchema, statementSchema } from './model.js';
import { z } from 'zod';
export const spanSchema = z.object({ start: z.number().int(), end: z.number().int() });
export const originSchema = z.object({ rootId: z.string(), path: z.string(), language: z.string(), hash: z.string(), annotation: spanSchema, content: spanSchema, edit: spanSchema, line: z.number().int(), targetKind: z.string() });
export const diagnosticSchema = z.object({ code: z.string(), message: z.string(), rootId: z.string().optional(), path: z.string().optional(), line: z.number().optional(), scope: z.string().optional(), nodeId: idSchema.optional() });
const provenanceSchema = z.object({ nodeId: idSchema, path: z.array(z.string()) });
const linkSchema = z.object({ relation: idSchema, target: idSchema, position: z.number().int().optional(), statement: statementSchema.optional() });
const inheritedStatementSchema = statementSchema.extend({ origins: z.array(provenanceSchema) });
const baseEdgeSchema = linkSchema.extend({ source: idSchema });
export const edgeSchema = baseEdgeSchema.extend({ origins: z.array(provenanceSchema).optional(), targetStatus: z.enum(['available', 'unresolved', 'out-of-scope']) });
export const effectiveSchema = z.object({
  id: idSchema, lineage: z.array(z.object({ id: idSchema, path: z.array(z.string()) })),
  inheritance: z.array(baseEdgeSchema), definitions: z.array(z.object({ id: idSchema, title: z.string(), content: z.string(), origin: originSchema, path: z.array(z.string()) })),
  statements: z.array(inheritedStatementSchema),
  conflicts: z.array(z.object({ predicate: z.string(), values: z.array(z.unknown()) })), diagnostics: z.array(diagnosticSchema), complete: z.boolean(),
});
export const operationDescriptionSchema = z.object({ name: z.string(), description: z.string(), extension: z.string(), implementationId: z.string().optional(), input: z.record(z.string(), z.unknown()), output: z.record(z.string(), z.unknown()) });
export const summarySchema = z.object({ id: idSchema, title: z.string(), scope: z.string(), summary: z.string(), origin: originSchema, operations: z.array(z.string()) });
export const searchHitSchema = summarySchema.extend({ score: z.number(), channels: z.array(z.string()), matchedTerms: z.array(z.string()) });
export const discoverySchema = z.object({
  query: z.string(), terms: z.array(z.string()),
  candidates: z.array(summarySchema.extend({ score: z.number(), definition: z.string(), evidence: z.array(z.object({ via: z.string(), channels: z.array(z.string()), path: z.array(baseEdgeSchema), matchedTerms: z.array(z.string()) })) })),
  total: z.number().int(), nextOffset: z.number().int().nullable(), references: z.array(searchHitSchema),
  ambiguities: z.array(z.object({ name: z.string(), candidates: z.array(z.string()) })),
  unresolved: z.array(z.string()), diagnostics: z.array(diagnosticSchema), truncated: z.boolean(), referenceTotal: z.number().int(),
});
export const nodeSchema = z.object({ id: idSchema, title: z.string(), scope: z.string(), aliases: z.array(z.string()), content: z.string(), statements: z.array(statementSchema), origin: originSchema }).strict();
// @logos-id knowledge-node-schema
export const contextSchema = z.object({
  query: z.string(),
  items: z.array(summarySchema.extend({ category: z.enum(['applicable', 'concept', 'reference']), reasons: z.array(z.string()), statements: z.array(inheritedStatementSchema), inheritedFrom: z.array(z.string()) })), total: z.number().int(), nextOffset: z.number().int().nullable(),
  concepts: z.array(z.string()), conceptPaths: z.record(z.string(), z.array(z.string())), ambiguities: z.array(z.object({ name: z.string(), candidates: z.array(z.string()) })),
  grounding: z.object({ provided: z.array(z.string()), retrieved: z.array(z.string()), unresolved: z.array(z.string()) }),
  diagnostics: z.array(diagnosticSchema), incomplete: z.boolean(), truncated: z.boolean(), judgments: z.array(z.object({ operation: z.string(), result: z.unknown() })), conditionStatus: z.string(),
});
// @logos-id knowledge-context-schema
export const changeSchema = z.object({ id: idSchema, hash: z.string() });
