import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { EventBus } from '../index.js';

describe('EventBus', () => {
  let bus;

  beforeEach(() => {
    bus = new EventBus();
  });

  describe('publish', () => {
    it('publishes an event and logs it', () => {
      const result = bus.publish('test.event', { key: 'value' });
      assert.equal(result.event, 'test.event');
      assert.deepEqual(result.payload, { key: 'value' });
      assert.equal(result.subscribers_notified, 0);
      assert.ok(result.at);
    });

    it('notifies subscribers', () => {
      let received = null;
      bus.subscribe('test.event', 'listener', (payload) => { received = payload; });
      bus.publish('test.event', { data: 42 });
      assert.deepEqual(received, { data: 42 });
    });

    it('counts subscribers notified', () => {
      bus.subscribe('test.event', 'a', () => {});
      bus.subscribe('test.event', 'b', () => {});
      const result = bus.publish('test.event', {});
      assert.equal(result.subscribers_notified, 2);
    });

    it('fires with zero subscribers without error', () => {
      const result = bus.publish('nobody.listens', { data: 1 });
      assert.equal(result.subscribers_notified, 0);
    });

    it('catches subscriber errors without crashing', () => {
      bus.subscribe('test.event', 'broken', () => { throw new Error('handler failed'); });
      const result = bus.publish('test.event', {});
      assert.ok(result.errors.length > 0);
      assert.ok(result.errors[0].includes('handler failed'));
    });

    it('collects multiple subscriber errors without losing any', () => {
      bus.subscribe('test.event', 'broken1', () => { throw new Error('fail one'); });
      bus.subscribe('test.event', 'broken2', () => { throw new Error('fail two'); });
      const result = bus.publish('test.event', {});
      assert.equal(result.errors.length, 2);
      assert.ok(result.errors[0].includes('fail one'));
      assert.ok(result.errors[1].includes('fail two'));
    });
  });

  describe('subscribe', () => {
    it('registers a subscriber for an event', () => {
      bus.subscribe('my.event', 'mybundle', () => {});
      const subs = bus.subscriptions();
      assert.deepEqual(subs['my.event'], ['mybundle']);
    });

    it('allows multiple subscribers for the same event', () => {
      bus.subscribe('my.event', 'a', () => {});
      bus.subscribe('my.event', 'b', () => {});
      const subs = bus.subscriptions();
      assert.deepEqual(subs['my.event'], ['a', 'b']);
    });
  });

  describe('recentEvents', () => {
    it('returns the last N events', () => {
      bus.publish('e1', {});
      bus.publish('e2', {});
      bus.publish('e3', {});
      const recent = bus.recentEvents(2);
      assert.equal(recent.length, 2);
      assert.equal(recent[0].event, 'e2');
      assert.equal(recent[1].event, 'e3');
    });

    it('returns entries with errors as an array', () => {
      bus.subscribe('e1', 'broken', () => { throw new Error('oops'); });
      bus.publish('e1', {});
      const recent = bus.recentEvents(1);
      assert.ok(Array.isArray(recent[0].errors), 'errors should be an array');
      assert.equal(recent[0].errors.length, 1);
      assert.ok(recent[0].errors[0].includes('oops'));
    });
  });

  describe('log trimming', () => {
    it('trims log to maxLogEntries', () => {
      const small = new EventBus({ maxLogEntries: 3 });
      for (let i = 0; i < 10; i++) small.publish(`e${i}`, {});
      assert.equal(small.recentEvents(100).length, 3);
    });
  });

  describe('contract validation', () => {
    it('warns on undeclared event in warn mode', () => {
      bus.registerDeclaredEvents('myBundle', ['allowed.event']);
      const warnOrig = console.warn;
      const warnings = [];
      console.warn = (...args) => warnings.push(args);
      try {
        const result = bus.publish('forbidden.event', {}, { publisher: 'myBundle' });
        assert.equal(result.event, 'forbidden.event');
      } finally {
        console.warn = warnOrig;
      }
    });

    it('throws ContractViolationError on undeclared event in strict mode', () => {
      bus.setValidationMode('strict');
      bus.registerDeclaredEvents('myBundle', ['allowed.event']);
      assert.throws(
        () => bus.publish('forbidden.event', {}, { publisher: 'myBundle' }),
        (err) => {
          assert.equal(err.name, 'ContractViolationError');
          return true;
        }
      );
    });

    it('validates payload against registered schema', () => {
      bus.registerEventSchemas('myBundle', [
        { name: 'test.event', schema: { id: 'uuid', title: 'string' } },
      ]);
      const warnOrig = console.warn;
      const warnings = [];
      console.warn = (...args) => warnings.push(args);
      try {
        const result = bus.publish('test.event', { id: '123' }, { publisher: 'myBundle' });
        assert.equal(result.event, 'test.event');
      } finally {
        console.warn = warnOrig;
      }
    });

    it('throws on schema violation in strict mode', () => {
      bus.setValidationMode('strict');
      bus.registerDeclaredEvents('myBundle', ['test.event']);
      bus.registerEventSchemas('myBundle', [
        { name: 'test.event', schema: { id: 'uuid', title: 'string' } },
      ]);
      assert.throws(
        () => bus.publish('test.event', { id: '123' }, { publisher: 'myBundle' }),
        (err) => {
          assert.equal(err.name, 'ContractViolationError');
          assert.ok(err.message.includes('title'));
          return true;
        }
      );
    });
  });

  describe('queryEvents (durable mode)', () => {
    it('returns empty array when no db', () => {
      const result = bus.queryEvents('test.event');
      assert.deepEqual(result, []);
    });
  });

  describe('hookBus integration', () => {
    it('emits event:before-publish and event:after-publish when hookBus is provided', () => {
      const emitted = [];
      const mockHookBus = {
        emitSync: (hookName, data) => { emitted.push({ hookName, data }); },
      };

      const bus = new EventBus({ hookBus: mockHookBus });
      bus.publish('test.event', { key: 'value' }, { publisher: 'test-bundle' });

      assert.equal(emitted.length, 2);
      assert.equal(emitted[0].hookName, 'event:before-publish');
      assert.deepEqual(emitted[0].data, { event: 'test.event', payload: { key: 'value' }, publisher: 'test-bundle' });
      assert.equal(emitted[1].hookName, 'event:after-publish');
      assert.equal(emitted[1].data.event, 'test.event');
      assert.equal(emitted[1].data.subscribersNotified, 0);
    });

    it('does not throw when hookBus is not provided', () => {
      const bus = new EventBus();
      assert.doesNotThrow(() => bus.publish('test.event', {}));
    });
  });

  describe('unsubscribeBundle', () => {
    it('removes all subscriptions for the given bundle', () => {
      bus.subscribe('event.a', 'alpha', () => {});
      bus.subscribe('event.b', 'alpha', () => {});
      bus.subscribe('event.a', 'beta', () => {});

      bus.unsubscribeBundle('alpha');

      const subs = bus.subscriptions();
      assert.ok(!subs['event.a'] || !subs['event.a'].includes('alpha'), 'alpha should be removed from event.a');
      assert.ok(!subs['event.b'], 'event.b key should be gone (no remaining subscribers)');
    });

    it('is a no-op for a bundle that has no subscriptions', () => {
      bus.subscribe('event.a', 'beta', () => {});
      assert.doesNotThrow(() => bus.unsubscribeBundle('nonexistent'));
      const subs = bus.subscriptions();
      assert.deepEqual(subs['event.a'], ['beta']);
    });

    it('leaves other bundles\' subscriptions untouched', () => {
      bus.subscribe('event.a', 'alpha', () => {});
      bus.subscribe('event.a', 'beta', () => {});
      bus.subscribe('event.b', 'alpha', () => {});

      bus.unsubscribeBundle('alpha');

      const subs = bus.subscriptions();
      assert.deepEqual(subs['event.a'], ['beta'], 'beta should still be subscribed to event.a');
      assert.ok(!subs['event.b'], 'event.b should be removed since alpha was its only subscriber');
    });
  });
});
