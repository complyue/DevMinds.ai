/**
 * Minimal ToolRegistry skeleton for M3
 * - Safe, independent module (not wired to run coroutine yet)
 * - Next: add workspace.fs and workspace.shell (restricted) implementations
 */

export type ToolParamSpec = {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'json';
  required?: boolean;
  description?: string;
};

export type ToolContext = {
  // Safe context; no secrets exposed. Future: pass cwd for tests workspace only.
  nowIso: () => string;
};

export type ToolExecuteFn = (args: Record<string, any>, ctx: ToolContext) => Promise<any>;

export type Tool = {
  name: string;
  description: string;
  parameters?: ToolParamSpec[];
  execute: ToolExecuteFn;
  metadata?: Record<string, any>;
};

export class ToolRegistry {
  private tools: Map<string, Tool> = new Map();

  register(tool: Tool) {
    if (!tool?.name || typeof tool.execute !== 'function') {
      throw new Error('Invalid tool definition');
    }
    this.tools.set(tool.name, tool);
  }

  has(name: string) {
    return this.tools.has(name);
  }

  list(): Tool[] {
    return Array.from(this.tools.values());
  }

  async call(name: string, args: Record<string, any> = {}) {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new Error(`Tool not found: ${name}`);
    }
    // Minimal safe context
    const ctx: ToolContext = {
      nowIso: () => new Date().toISOString(),
    };
    return tool.execute(args, ctx);
  }
}

// Example placeholder tool (disabled by default; registry not exported globally)
export const exampleEchoTool: Tool = {
  name: 'echo',
  description: 'Echo back provided message',
  parameters: [{ name: 'message', type: 'string', required: true, description: 'Text to echo' }],
  async execute(args, ctx) {
    const msg = String(args?.message ?? '');
    return { ok: true, ts: ctx.nowIso(), message: msg };
  },
};
