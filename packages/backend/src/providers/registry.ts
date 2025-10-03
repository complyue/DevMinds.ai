export type ProviderCallParams = {
  provider: { apiType: string; baseUrl?: string };
  model: string;
  prompt: string;
  apiKey?: string;
};

export type ProviderHandler = (params: ProviderCallParams) => Promise<string>;

const registry = new Map<string, ProviderHandler>();

export function registerProvider(apiType: string, handler: ProviderHandler) {
  registry.set(apiType, handler);
}

export async function callProvider(apiType: string, params: ProviderCallParams): Promise<string> {
  const handler = registry.get(apiType);
  if (!handler) {
    throw new Error(`Unsupported apiType: ${apiType}`);
  }
  return handler(params);
}
