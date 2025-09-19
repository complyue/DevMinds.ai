/**
 * Event processing constructs equivalent to Edh's:
 * - PubChan: write-only broadcast channel
 * - SubChan: read-only subscriber channel
 * - EventSink: event source with sequence and most-recent value, streaming support
 *
 * Notes:
 * - PubChan behaves like a broadcast channel: if there is no SubChan reading, writes are effectively dropped
 * - SubChan buffers unboundedly relative to its own consumption speed
 * - EndOfStream sentinel signals termination of streams
 */

export const EndOfStream = Symbol("EndOfStream");
export type EOS = typeof EndOfStream;

/**
 * A small "deferred" helper to build a promise that can be resolved externally.
 */
function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

type NodeValue<T> = [value: T | EOS, next: Promise<NodeValue<T>>];

/**
 * PubChan: publisher's write-only channel.
 * Internally maintains a linked list of deferred promises to form a stream.
 */
export class PubChan<T> {
  // The head of the chain: a deferred whose promise yields [ev, nextPromise]
  private nxt = deferred<NodeValue<T>>();

  /**
   * Write an event into the channel.
   * Subsequent readers will observe it in order.
   */
  write(ev: T | EOS): void {
    const next = deferred<NodeValue<T>>();
    // Resolve current node with [event, nextPromise], then advance head
    this.nxt.resolve([ev, next.promise]);
    this.nxt = next;
  }

  /**
   * Async iterator of subsequent events published to this channel.
   * Terminates when EndOfStream is encountered.
   */
  async *stream(): AsyncGenerator<T, void, void> {
    let nxtP = this.nxt.promise;
    // Iterate through the promise-linked stream
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const [ev, nextP] = await Promise.resolve(nxtP);
      if (ev === EndOfStream) return;
      yield ev as T;
      // advance
      nxtP = nextP;
    }
  }

  /**
   * Expose current next promise for SubChan to adopt.
   * Consumers should typically not use this directly.
   */
  get nextPromise(): Promise<NodeValue<T>> {
    return this.nxt.promise;
  }
}

/**
 * SubChan: subscriber's read-only channel.
 * Holds its own pointer into the shared stream chain, thus buffering
 * independently of other subscribers.
 */
export class SubChan<T> {
  private nxtP: Promise<NodeValue<T>>;

  constructor(pub: PubChan<T>) {
    this.nxtP = pub.nextPromise;
  }

  /**
   * Read the next available value (could be EndOfStream).
   * Caller may check ev === EndOfStream to detect eos.
   */
  async read(): Promise<T | EOS> {
    const [ev, nextP] = await Promise.resolve(this.nxtP);
    this.nxtP = nextP;
    return ev;
  }

  /**
   * Async iterator over values until EndOfStream.
   */
  async *stream(): AsyncGenerator<T, void, void> {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const [ev, nextP] = await Promise.resolve(this.nxtP);
      this.nxtP = nextP;
      if (ev === EndOfStream) return;
      yield ev as T;
    }
  }
}

/**
 * EventSink: holds sequence, most recent value, and a PubChan.
 * Provides stream(), one_more(), and run_producer() helpers.
 */
export class EventSink<T> {
  private seqn = 0;
  private mrv: T | EOS | null = null;
  private readonly chan = new PubChan<T>();

  get eos(): boolean {
    return this.mrv === EndOfStream;
  }

  /**
   * Publish an event. Increments sequence (wraps int64 max to 1).
   */
  publish(ev: T | EOS): void {
    if (this.seqn >= 9223372036854775807) {
      this.seqn = 1;
    } else {
      this.seqn += 1;
    }
    this.mrv = ev;
    this.chan.write(ev);
  }

  /**
   * Await exactly one more item from the stream unless already at eos.
   * If already eos after at least one event, returns EndOfStream immediately.
   */
  async one_more(): Promise<T | EOS> {
    if (this.seqn > 0 && this.mrv === EndOfStream) {
      return EndOfStream;
    }
    // Peek the next from channel's head
    const [ev] = await this.chan.nextPromise;
    return ev;
  }

  /**
   * Async iterator: yields the most recent value first (if any and not eos),
   * then continues with subsequent events until EndOfStream.
   */
  async *stream(): AsyncGenerator<T, void, void> {
    if (this.seqn > 0) {
      if (this.mrv === EndOfStream) return;
      // yield the most recent first
      yield this.mrv as T;
    }
    let nxtP = this.chan.nextPromise;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const [ev, nextP] = await Promise.resolve(nxtP);
      if (ev === EndOfStream) return;
      yield ev as T;
      nxtP = nextP;
    }
  }

  /**
   * Run a producer Promise concurrently while yielding the stream.
   * - Starts consuming after the caller begins iterating to avoid missing events.
   * - If the producer completes, continues consuming until EndOfStream.
   *
   * Usage pattern:
   *   for await (const ev of sink.run_producer(startProducer())) { ... }
   *
   * The producer should publish into this sink and eventually publish EndOfStream.
   */
  async *run_producer(
    producer: Promise<unknown>,
  ): AsyncGenerator<T, void, void> {
    let nxtP = this.chan.nextPromise;

    // We loop, racing "next event" vs "producer completion"
    // After producer completes, we keep draining until EndOfStream.
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const nextEventP = Promise.resolve(nxtP).then(([ev, nextP]) => ({
        kind: "event" as const,
        ev,
        nextP,
      }));
      const prodDoneP = Promise.resolve(producer).then(() => ({
        kind: "done" as const,
      }));

      const winner = await Promise.race([nextEventP, prodDoneP]);

      if (winner.kind === "event") {
        if (winner.ev === EndOfStream) return;
        yield winner.ev as T;
        nxtP = winner.nextP;
        continue;
      }

      // Producer done; now drain until EOS
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const [ev, nextP] = await Promise.resolve(nxtP);
        if (ev === EndOfStream) return;
        yield ev as T;
        nxtP = nextP;
      }
    }
  }
}

/**
 * Helpers to create channels/sinks
 */
export function createPubChan<T>(): PubChan<T> {
  return new PubChan<T>();
}

export function createSubChan<T>(pub: PubChan<T>): SubChan<T> {
  return new SubChan<T>(pub);
}

export function createEventSink<T>(): EventSink<T> {
  return new EventSink<T>();
}
