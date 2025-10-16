import { promises as fs } from 'fs';
import path from 'path';
import url from 'url';
import * as yaml from 'js-yaml';

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function fileExists(p: string) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function readText(p: string) {
  return fs.readFile(p, 'utf8');
}

/**
 * Load built-in provider template from YAML.
 * Ensures 'mock' provider presence as fallback.
 */
export async function loadProviderTemplate() {
  const templatePath = path.join(__dirname, '../config/known-providers.yaml');
  try {
    if (await fileExists(templatePath)) {
      const yamlContent = await readText(templatePath);
      const cfg = yaml.load(yamlContent) as any;
      if (!cfg?.providers) cfg.providers = {};
      if (!cfg.providers.mock) {
        cfg.providers.mock = {
          name: 'MockLLM',
          apiType: 'mock',
          baseUrl: '',
          models: ['test-model'],
          apiKeyEnvVar: 'DEVMINDS_MOCK_DIR',
        };
      }
      return cfg;
    }
  } catch (error) {
    console.warn('Failed to load provider template:', error);
  }
  // Fallback
  return {
    providers: {
      openai: {
        name: 'OpenAI',
        apiType: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        models: ['gpt-5', 'gpt-5-mini', 'gpt-5-nano'],
        apiKeyEnvVar: 'OPENAI_API_KEY',
      },
      anthropic: {
        name: 'Anthropic',
        apiType: 'anthropic',
        baseUrl: 'https://api.anthropic.com',
        models: ['claude-4-sonnet'],
        apiKeyEnvVar: 'ANTHROPIC_AUTH_TOKEN',
      },
      mock: {
        name: 'MockLLM',
        apiType: 'mock',
        baseUrl: '',
        models: ['test-model'],
        apiKeyEnvVar: 'DEVMINDS_MOCK_DIR',
      },
    },
  };
}

/**
 * Runtime provider configuration from .minds/provider.yaml (if present)
 */
export async function loadRuntimeProviderConfig(paths: { minds: (...p: string[]) => string }) {
  const runtimePath = paths.minds('provider.yaml');
  try {
    if (await fileExists(runtimePath)) {
      const yamlContent = await readText(runtimePath);
      if (yamlContent && yamlContent.trim().length > 0) {
        const doc = yaml.load(yamlContent) as any;
        if (doc && typeof doc === 'object') {
          return doc;
        }
      }
    }
  } catch (error) {
    console.warn('Failed to load runtime provider config:', error);
  }
  return null;
}

/**
 * Deep-merge provider configs: runtime overrides built-in.
 */
export function mergeProviderConfigs(baseCfg: any, runtimeCfg: any) {
  if (!runtimeCfg) return { merged: baseCfg, hadRuntime: false };

  const isObject = (v: any) => v && typeof v === 'object' && !Array.isArray(v);

  const merge = (a: any, b: any): any => {
    if (Array.isArray(a) || Array.isArray(b)) {
      return b !== undefined ? b : a;
    }
    if (isObject(a) && isObject(b)) {
      const out: any = { ...a };
      for (const k of Object.keys(b)) {
        out[k] = merge(a[k], b[k]);
      }
      return out;
    }
    return b !== undefined ? b : a;
  };

  const baseProviders = baseCfg?.providers && isObject(baseCfg.providers) ? baseCfg.providers : {};
  const runtimeProviders =
    runtimeCfg?.providers && isObject(runtimeCfg.providers) ? runtimeCfg.providers : {};

  const mergedProviders: any = { ...baseProviders };
  for (const pid of Object.keys(runtimeProviders)) {
    mergedProviders[pid] = merge(baseProviders[pid], runtimeProviders[pid]);
  }

  const mergedTop = merge(baseCfg, runtimeCfg);
  mergedTop.providers = mergedProviders;

  return { merged: mergedTop, hadRuntime: true };
}
