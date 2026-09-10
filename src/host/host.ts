import { z } from 'zod';
import type { Reader, SourceInput } from '../knowledge/model.js';
export interface CallContext { project?: string; taskId?: string }
export interface Operation<I = any> {
  name: string; description: string; input: z.ZodType<I>; output: z.ZodType;
  implementationId?: string;
  handler(input: I, context: CallContext): unknown | Promise<unknown>;
}
export interface Extension {
  id: string; description: string; requires?: string[]; implementationId?: string;
  setup(host: Host, options?: unknown): void | Promise<void>;
}
// @logos-id implementation/host
export class Host {
  readonly readers: Reader[] = [];
  readonly sources: (() => Promise<SourceInput[]>)[] = [];
  private operations = new Map<string, Operation & { extension: string }>();
  private extensions = new Map<string, { id: string; description: string; requires: string[]; entry: string; implementationId?: string }>();
  private owner = '';
  private ownerImplementation: string | undefined;
  constructor(readonly workspace: string) {}
  register<I>(operation: Operation<I>) {
    if (!this.owner) throw new Error('Operations must be registered during extension setup');
    if (this.operations.has(operation.name)) throw new Error(`Duplicate operation: ${operation.name}`);
    this.operations.set(operation.name, { ...operation, implementationId: operation.implementationId ?? this.ownerImplementation, extension: this.owner });
  }
  addReader(reader: Reader) {
    if (this.readers.some(r => r.id === reader.id || r.extensions.some(ext => reader.extensions.includes(ext)))) throw new Error(`Conflicting reader: ${reader.id}`);
    this.readers.push(reader);
  }
  async load(entries: { extension: Extension; entry: string; options?: unknown }[]) {
    if (new Set(entries.map(e => e.extension.id)).size !== entries.length) throw new Error('Duplicate extension ID');
    const pending = [...entries];
    while (pending.length) {
      const index = pending.findIndex(e => (e.extension.requires ?? []).every(id => this.extensions.has(id)));
      if (index < 0) throw new Error('Missing or cyclic extension dependencies: ' + pending.map(e => e.extension.id).join(', '));
      const item = pending.splice(index, 1)[0]; const ext = item.extension;
      this.owner = ext.id; this.ownerImplementation = ext.implementationId;
      try { await ext.setup(this, item.options); }
      finally { this.owner = ''; this.ownerImplementation = undefined; }
      this.extensions.set(ext.id, { id: ext.id, description: ext.description, requires: ext.requires ?? [], entry: item.entry, implementationId: ext.implementationId });
    }
  }
  describe() {
    return { extensions: [...this.extensions.values()], readers: this.readers.map(({ id, extensions }) => ({ id, extensions })), operations: [...this.operations.values()].map(op => ({ name: op.name, description: op.description, extension: op.extension, implementationId: op.implementationId, input: z.toJSONSchema(op.input), output: z.toJSONSchema(op.output) })) };
  }
  async call(name: string, input: unknown = {}, context: CallContext = {}): Promise<any> {
    const op = this.operations.get(name);
    if (!op) throw new Error(`Unknown or disabled operation: ${name}`);
    return op.output.parse(await op.handler(op.input.parse(input), context));
  }
  async resolve(id: string, context: CallContext = {}) { return this.call('knowledge.get', { id }, context); }
}
