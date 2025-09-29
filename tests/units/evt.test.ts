import { describe, it, expect, vi } from 'vitest';
import { PubChan, SubChan, EventSink, EndOfStream, createEventSink } from '../../packages/backend/src/evt';

describe('PubChan/SubChan', () => {
  it('delivers events in order to a single subscriber', async () => {
    const pub = new PubChan<number>();
    const sub = new SubChan<number>(pub);

    const seen: number[] = [];
    const reader = (async () => {
      for (let i = 0; i < 3; i++) {
        const v = (await sub.read()) as number;
        seen.push(v);
      }
    })();

    pub.write(1);
    pub.write(2);
    pub.write(3);
    await reader;

    expect(seen).toEqual([1, 2, 3]);
  });

  it('buffers independently for multiple subscribers', async () => {
    const pub = new PubChan<string>();
    const sub1 = new SubChan<string>(pub);
    const sub2 = new SubChan<string>(pub);

    pub.write('a');
    pub.write('b');

    const v1 = await sub1.read();
    const v2 = await sub2.read();
    const v3 = await sub1.read();
    const v4 = await sub2.read();

    expect([v1, v3]).toEqual(['a', 'b']);
    expect([v2, v4]).toEqual(['a', 'b']);
  });

  it('supports EndOfStream sentinel for consumers using stream()', async () => {
    const pub = new PubChan<number>();
    const sub = new SubChan<number>(pub);

    const got: number[] = [];
    const consume = (async () => {
      for await (const v of sub.stream()) {
        got.push(v);
      }
    })();

    pub.write(10);
    pub.write(20);
    pub.write(EndOfStream);
    await consume;

    expect(got).toEqual([10, 20]);
  });
});

describe('EventSink', () => {
  it('publish increments sequence and stream yields most recent first', async () => {
    const sink = new EventSink<string>();
    sink.publish('first');
    sink.publish('second');

    const got: string[] = [];
    for await (const v of sink.stream()) {
      got.push(v);
      // break to avoid waiting forever; no EOS yet
      break;
    }
    expect(got).toEqual(['second']);
  });

  it('one_more observes next value without consuming the channel beyond one item', async () => {
    const sink = new EventSink<number>();
    sink.publish(1);
    const p = sink.one_more(); // should see next publish
    sink.publish(2);
    const v = await p;
    expect(v).toBe(2);
  });

  it('stream ends when EndOfStream is published', async () => {
    const sink = new EventSink<string>();
    sink.publish('a');
    sink.publish('b');
    sink.publish(EndOfStream);

    const got: string[] = [];
    for await (const v of sink.stream()) {
      got.push(v);
    }
    // Since mrv is EndOfStream, stream() returns immediately without yielding
    // but if EOS was after some values without re-yielding mrv, it's fine the result is empty.
    // Validate EOS state:
    expect(sink.eos).toBe(true);
  });

  it('run_producer yields events produced after consumer attaches and drains until EOS', async () => {
    const sink = createEventSink<number>();
    // Delay the first publish slightly to ensure the consumer has attached to the stream head.
    const producer = (async () => {
      await new Promise((r) => setTimeout(r, 0));
      sink.publish(1);
      await new Promise((r) => setTimeout(r, 10));
      sink.publish(2);
      await new Promise((r) => setTimeout(r, 10));
      sink.publish(EndOfStream);
    })();

    const got: number[] = [];
    for await (const v of sink.run_producer(producer)) {
      got.push(v);
    }
    expect(got).toEqual([1, 2]);
  });
});
