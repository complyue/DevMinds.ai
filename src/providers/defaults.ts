import { registerProvider, ProviderCallParams } from './registry.js';

async function callOpenAI({
  provider,
  model,
  prompt,
  apiKey,
}: ProviderCallParams): Promise<string> {
  const baseUrl = (provider.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const urlStr = `${baseUrl}/chat/completions`;
  const body = { model, messages: [{ role: 'user', content: prompt }], stream: false };
  const resp = await fetch(urlStr, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` } as any,
    body: JSON.stringify(body),
  });
  const text = await resp.text();
  if (!resp.ok) throw new Error(`Agent HTTP ${resp.status}: ${text.slice(0, 500)}`);
  try {
    const j = JSON.parse(text);
    const c = j?.choices?.[0]?.message?.content ?? j?.choices?.[0]?.text;
    return typeof c === 'string' && c.trim().length > 0 ? c : text;
  } catch {
    return text;
  }
}

async function callAnthropic({
  provider,
  model,
  prompt,
  apiKey,
}: ProviderCallParams): Promise<string> {
  const baseUrl = (provider.baseUrl || 'https://api.anthropic.com').replace(/\/+$/, '');
  const urlStr = `${baseUrl}/v1/messages`;
  const body = {
    model,
    max_tokens: 1024,
    messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
  };
  const resp = await fetch(urlStr, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    } as any,
    body: JSON.stringify(body),
  });
  const text = await resp.text();
  if (!resp.ok) throw new Error(`Agent HTTP ${resp.status}: ${text.slice(0, 500)}`);
  try {
    const j = JSON.parse(text);
    const c = j?.content?.[0]?.text;
    return typeof c === 'string' && c.trim().length > 0 ? c : text;
  } catch {
    return text;
  }
}

registerProvider('openai', callOpenAI);
registerProvider('anthropic', callAnthropic);
