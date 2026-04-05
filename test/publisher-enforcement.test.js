/**
 * Tests for publisher identity enforcement in EventBus (Phase 3, Task 6).
 *
 * When any bundle has registered declared events via registerDeclaredEvents(),
 * calls to publish() or publishAsync() without a `publisher:` option must
 * trigger a contract violation (warn in warn mode, throw in strict mode).
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { EventBus } from '../index.js';
import { ContractViolationError } from '@torquedev/core';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeBus(mode = 'warn') {
  const bus = new EventBus({ silent: true });
  bus.setValidationMode(mode);
  return bus;
}

function captureWarnings(fn) {
  const warnings = [];
  const origWarn = console.warn;
  console.warn = (...args) => warnings.push(args.join(' '));
  try {
    fn();
  } finally {
    console.warn = origWarn;
  }
  return warnings;
}

async function captureWarningsAsync(fn) {
  const warnings = [];
  const origWarn = console.warn;
  console.warn = (...args) => warnings.push(args.join(' '));
  try {
    await fn();
  } finally {
    console.warn = origWarn;
  }
  return warnings;
}

// ── publish() enforcement ──────────────────────────────────────────────────────

describe('EventBus publisher enforcement – publish()', () => {
  it('throws in strict mode when publisher is omitted and declared events exist', () => {
    const bus = makeBus('strict');
    bus.registerDeclaredEvents('myBundle', ['test.event']);

    assert.throws(
      () => bus.publish('test.event', {}),
      (err) => {
        assert.ok(err instanceof ContractViolationError, `Expected ContractViolationError, got ${err.constructor.name}`);
        assert.ok(
          err.message.includes('without publisher'),
          `Expected 'without publisher' in message, got: ${err.message}`
        );
        return true;
      }
    );
  });

  it('warns in warn mode when publisher is omitted and declared events exist', () => {
    const bus = makeBus('warn');
    bus.registerDeclaredEvents('myBundle', ['test.event']);

    const warnings = captureWarnings(() => {
      const result = bus.publish('test.event', {});
      assert.equal(result.event, 'test.event', 'publish should still return entry in warn mode');
    });

    assert.ok(
      warnings.some(w => w.includes('without publisher')),
      `Expected 'without publisher' warning, got: ${warnings.join('; ')}`
    );
  });

  it('does not warn when publisher is provided', () => {
    const bus = makeBus('warn');
    bus.registerDeclaredEvents('myBundle', ['test.event']);

    const warnings = captureWarnings(() => {
      bus.publish('test.event', {}, { publisher: 'myBundle' });
    });

    assert.ok(
      !warnings.some(w => w.includes('without publisher')),
      `Should not warn about publisher when it is provided, got: ${warnings.join('; ')}`
    );
  });

  it('does not warn when no bundles have declared events', () => {
    const bus = makeBus('warn');
    // No registerDeclaredEvents calls — bus is in "unconstrained" mode

    const warnings = captureWarnings(() => {
      bus.publish('any.event', { data: 1 });
    });

    assert.ok(
      !warnings.some(w => w.includes('without publisher')),
      'Should not warn about missing publisher when no declared events registered'
    );
  });

  it('includes the event name in the violation message', () => {
    const bus = makeBus('strict');
    bus.registerDeclaredEvents('myBundle', ['task.created']);

    assert.throws(
      () => bus.publish('task.created', {}),
      (err) => {
        assert.ok(err.message.includes('task.created'), `Event name missing from: ${err.message}`);
        return true;
      }
    );
  });

  it('still fires subscribers in warn mode even without publisher', () => {
    const bus = makeBus('warn');
    bus.registerDeclaredEvents('myBundle', ['test.event']);

    let received = null;
    bus.subscribe('test.event', 'listener', (payload) => { received = payload; });

    captureWarnings(() => bus.publish('test.event', { x: 42 }));
    assert.deepEqual(received, { x: 42 }, 'subscriber should still fire in warn mode');
  });
});

// ── publishAsync() enforcement ─────────────────────────────────────────────────

describe('EventBus publisher enforcement – publishAsync()', () => {
  it('throws in strict mode when publisher is omitted and declared events exist', async () => {
    const bus = makeBus('strict');
    bus.registerDeclaredEvents('myBundle', ['async.event']);

    await assert.rejects(
      () => bus.publishAsync('async.event', {}),
      (err) => {
        assert.ok(err instanceof ContractViolationError);
        assert.ok(err.message.includes('without publisher'));
        return true;
      }
    );
  });

  it('warns in warn mode when publisher is omitted', async () => {
    const bus = makeBus('warn');
    bus.registerDeclaredEvents('myBundle', ['async.event']);

    const warnings = await captureWarningsAsync(async () => {
      const result = await bus.publishAsync('async.event', {});
      assert.equal(result.event, 'async.event');
    });

    assert.ok(
      warnings.some(w => w.includes('without publisher')),
      `Expected 'without publisher' warning, got: ${warnings.join('; ')}`
    );
  });

  it('does not warn when publisher is provided to publishAsync()', async () => {
    const bus = makeBus('warn');
    bus.registerDeclaredEvents('myBundle', ['async.event']);

    const warnings = await captureWarningsAsync(async () => {
      await bus.publishAsync('async.event', {}, { publisher: 'myBundle' });
    });

    assert.ok(
      !warnings.some(w => w.includes('without publisher')),
      'Should not warn when publisher is provided to publishAsync()'
    );
  });

  it('does not warn when no declared events exist', async () => {
    const bus = makeBus('warn');
    // No registerDeclaredEvents

    const warnings = await captureWarningsAsync(async () => {
      await bus.publishAsync('any.event', {});
    });

    assert.ok(
      !warnings.some(w => w.includes('without publisher')),
      'Should not warn when no declared events are registered'
    );
  });
});

// ── enforcement vs existing undeclared-event check ────────────────────────────

describe('EventBus publisher enforcement – interaction with undeclared-event check', () => {
  it('publisher-missing check fires even when event IS declared (publisher:  is still required)', () => {
    const bus = makeBus('strict');
    bus.registerDeclaredEvents('myBundle', ['test.event']);

    // test.event is declared, but publisher is omitted → should still enforce
    assert.throws(
      () => bus.publish('test.event', {}),
      (err) => {
        assert.ok(err.message.includes('without publisher'));
        return true;
      }
    );
  });

  it('undeclared-event check still fires when publisher IS provided but event is not declared', () => {
    const bus = makeBus('strict');
    bus.registerDeclaredEvents('myBundle', ['allowed.event']);

    assert.throws(
      () => bus.publish('forbidden.event', {}, { publisher: 'myBundle' }),
      (err) => {
        assert.ok(err.message.includes('undeclared') || err.message.includes('forbidden.event'));
        return true;
      }
    );
  });

  it('no violation when publisher is correct and event is declared', () => {
    const bus = makeBus('strict');
    bus.registerDeclaredEvents('myBundle', ['test.event']);

    assert.doesNotThrow(() => bus.publish('test.event', {}, { publisher: 'myBundle' }));
  });
});
