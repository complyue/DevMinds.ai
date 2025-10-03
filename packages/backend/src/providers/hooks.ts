/**
 * Generic provider extension loader for tests or plugins.
 * Business code stays provider-agnostic; this only loads extra modules if specified.
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const extra = process.env.DEV_PROVIDER_EXTRA;
if (extra && typeof extra === 'string' && extra.trim().length > 0) {
  const modules = extra
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  for (const m of modules) {
    try {
      const resolved = m.startsWith('file://')
        ? m
        : m.startsWith('/')
          ? pathToFileURL(m).href
          : pathToFileURL(path.resolve(process.cwd(), m)).href;
      await import(resolved);
    } catch (err) {
      console.warn('DEV_PROVIDER_EXTRA failed to load module:', m, err);
    }
  }
}
