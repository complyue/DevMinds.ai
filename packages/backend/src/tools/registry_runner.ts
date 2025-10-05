import { ToolRegistry } from './registry.js';

async function main() {
  const reg = new ToolRegistry();
  // Minimal echo tool
  reg.register({
    name: 'echo',
    description: 'Echo back message',
    parameters: [{ name: 'message', type: 'string', required: true }],
    async execute(args: any) {
      const msg = String(args?.message || '');
      return { ok: true, echoed: msg };
    },
    metadata: { version: '0.1' },
  });

  // Invoke with a sample payload
  const result = await reg.call('echo', { message: 'hello-tool' });
  console.log(JSON.stringify(result));
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: String(err?.message || err) }));
  process.exit(1);
});
