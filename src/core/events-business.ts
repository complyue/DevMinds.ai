/**
 * Events business helpers: ask-await registry and event interpretation.
 * Kept framework-agnostic; server composes these with transport.
 */

const askWaiters = new Map<string, (ans: any) => void>();

/**
 * Return a Promise that resolves when an agent.ask.response carrying the same questionId arrives.
 */
export function waitForAnswer(questionId: string): Promise<any> {
  return new Promise((resolve) => {
    askWaiters.set(String(questionId), resolve);
  });
}

/**
 * Interpret events to resolve ask-await promises.
 * Safe to call on every appended event.
 */
export function handleEventBusiness(ev: any) {
  try {
    if (ev && ev.type === 'agent.ask.response') {
      const qid = ev?.payload?.questionId ?? ev?.payload?.qid ?? ev?.payload?.id;
      if (qid && askWaiters.has(String(qid))) {
        const resolve = askWaiters.get(String(qid))!;
        askWaiters.delete(String(qid));
        resolve(ev.payload);
      }
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[ask-await] handleEventBusiness error:', err);
  }
}
