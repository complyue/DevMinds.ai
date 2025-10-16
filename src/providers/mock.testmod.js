/**
 * Test-only module that registers a mock provider (pure JS for ESM runtime).
 * Loaded via DEV_PROVIDER_EXTRA during unit tests; not referenced by business code.
 */
import { registerProvider } from './registry.js';

registerProvider('mock', async ({ model, prompt }) => {
  const p = (prompt || '').replace(/\s+/g, ' ').slice(0, 50);
  return `mock:${model}:${p}`;
});
