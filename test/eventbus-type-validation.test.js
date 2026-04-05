/**
 * Tests for typeValidator injection and payload type validation in EventBus.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { EventBus } from '../index.js';

// ── Test helpers ───────────────────────────────────────────────────────────

/**
 * Mock typeValidator: basic type checking, tracks calls.
 */
function createMockTypeValidator() {
  const calls = [];
  const fn = (declaredType, actualValue, fieldName) => {
    calls.push({ declaredType, actualValue, fieldName });
    const checks = {
      string: (v) => typeof v === 'string',
      text: (v) => typeof v === 'string',
      uuid: (v) => typeof v === 'string' && /^[0-9a-f]{8}-/.test(v),
      integer: (v) => Number.isInteger(v),
      boolean: (v) => typeof v === 'boolean',
    };
    const check = checks[declaredType];
    if (check && !check(actualValue)) {
      return `field '${fieldName}': expected ${declaredType}, got ${typeof actualValue}`;
    }
    return null;
  };
  fn.calls = calls;
  return fn;
}

/**
 * Capture console.warn calls during a callback.
 */
function captureWarnings(callback) {
  const warnings = [];
  const origWarn = console.warn;
  console.warn = (...args) => warnings.push(args.join(' '));
  try {
    const result = callback();
    return { result, warnings };
  } finally {
    console.warn = origWarn;
  }
}

/**
 * Async version of captureWarnings.
 */
async function captureWarningsAsync(callback) {
  const warnings = [];
  const origWarn = console.warn;
  console.warn = (...args) => warnings.push(args.join(' '));
  try {
    const result = await callback();
    return { result, warnings };
  } finally {
    console.warn = origWarn;
  }
}

// ── Task 8: Constructor injection ─────────────────────────────────────────

describe('EventBus typeValidator injection', () => {
  it('stores typeValidator when provided', () => {
    const tv = createMockTypeValidator();
    const bus = new EventBus({ typeValidator: tv });
    assert.equal(bus._typeValidator, tv);
  });

  it('defaults _typeValidator to null when not provided', () => {
    const bus = new EventBus();
    assert.equal(bus._typeValidator, null);
  });

  it('publish() still works without typeValidator (backward compat)', () => {
    const bus = new EventBus();
    const result = bus.publish('test.event', { key: 'value' });
    assert.equal(result.event, 'test.event');
  });
});

// ── Task 9: publish() payload type validation ───────────────────────────────

describe('EventBus publish() payload type validation', () => {
  it('warns when payload field has wrong type (warn mode)', () => {
    const tv = createMockTypeValidator();
    const bus = new EventBus({ typeValidator: tv });
    bus.registerEventSchemas('tasks', [
      { name: 'task.created', schema: { taskId: 'uuid', title: 'string' } },
    ]);

    const { result, warnings } = captureWarnings(() =>
      bus.publish('task.created', { taskId: 42, title: 'Test' })
    );

    assert.equal(result.event, 'task.created');
    assert.ok(warnings.some(w => w.includes('taskId')), `should warn about 'taskId', got: ${JSON.stringify(warnings)}`);
  });

  it('throws when payload field has wrong type (strict mode)', () => {
    const tv = createMockTypeValidator();
    const bus = new EventBus({ typeValidator: tv });
    bus.setValidationMode('strict');
    bus.registerEventSchemas('tasks', [
      { name: 'task.created', schema: { taskId: 'uuid', title: 'string' } },
    ]);

    assert.throws(
      () => bus.publish('task.created', { taskId: 42, title: 'Test' }),
      (err) => {
        assert.equal(err.name, 'ContractViolationError');
        assert.ok(err.message.includes('taskId'), `should mention 'taskId', got: ${err.message}`);
        return true;
      }
    );
  });

  it('passes when all payload fields have correct types', () => {
    const tv = createMockTypeValidator();
    const bus = new EventBus({ typeValidator: tv });
    bus.setValidationMode('strict');
    bus.registerEventSchemas('tasks', [
      { name: 'task.created', schema: { taskId: 'uuid', title: 'string' } },
    ]);

    const result = bus.publish('task.created', {
      taskId: '550e8400-e29b-41d4-a716-446655440000',
      title: 'Test',
    });
    assert.equal(result.event, 'task.created');
    assert.ok(tv.calls.length >= 2, `typeValidator should check payload fields, got ${tv.calls.length} calls`);
  });

  it('skips type validation when no typeValidator', () => {
    const bus = new EventBus(); // no typeValidator
    bus.setValidationMode('strict');
    bus.registerEventSchemas('tasks', [
      { name: 'task.created', schema: { taskId: 'uuid', title: 'string' } },
    ]);

    // Wrong type but no validator -- should NOT throw
    // (existing field presence check still runs, so both fields must be present)
    const result = bus.publish('task.created', { taskId: 42, title: 'Test' });
    assert.equal(result.event, 'task.created');
  });

  it('does not type-check fields missing from payload (presence check handles that)', () => {
    const tv = createMockTypeValidator();
    const bus = new EventBus({ typeValidator: tv });
    bus.registerEventSchemas('tasks', [
      { name: 'task.created', schema: { taskId: 'uuid', title: 'string' } },
    ]);

    captureWarnings(() => bus.publish('task.created', { taskId: '550e8400-e29b-41d4-a716-446655440000' }));
    // title is missing -- presence check catches it, but typeValidator should NOT be called for 'title'
    const titleCalls = tv.calls.filter(c => c.fieldName === 'title');
    assert.equal(titleCalls.length, 0, 'should not type-check missing payload fields');
  });
});

// ── Task 10: publishAsync() type validation + shared helper ─────────────────

describe('EventBus publishAsync() payload type validation', () => {
  it('warns when payload field has wrong type (warn mode)', async () => {
    const tv = createMockTypeValidator();
    const bus = new EventBus({ typeValidator: tv });
    bus.registerEventSchemas('tasks', [
      { name: 'task.created', schema: { taskId: 'uuid', title: 'string' } },
    ]);

    const { result, warnings } = await captureWarningsAsync(() =>
      bus.publishAsync('task.created', { taskId: 42, title: 'Test' })
    );

    assert.equal(result.event, 'task.created');
    assert.ok(warnings.some(w => w.includes('taskId')), `should warn about 'taskId', got: ${JSON.stringify(warnings)}`);
  });

  it('throws when payload field has wrong type (strict mode)', async () => {
    const tv = createMockTypeValidator();
    const bus = new EventBus({ typeValidator: tv });
    bus.setValidationMode('strict');
    bus.registerEventSchemas('tasks', [
      { name: 'task.created', schema: { taskId: 'uuid', title: 'string' } },
    ]);

    await assert.rejects(
      () => bus.publishAsync('task.created', { taskId: 42, title: 'Test' }),
      (err) => {
        assert.equal(err.name, 'ContractViolationError');
        assert.ok(err.message.includes('taskId'));
        return true;
      }
    );
  });

  it('passes when all payload fields have correct types', async () => {
    const tv = createMockTypeValidator();
    const bus = new EventBus({ typeValidator: tv });
    bus.setValidationMode('strict');
    bus.registerEventSchemas('tasks', [
      { name: 'task.created', schema: { taskId: 'uuid', title: 'string' } },
    ]);

    const result = await bus.publishAsync('task.created', {
      taskId: '550e8400-e29b-41d4-a716-446655440000',
      title: 'Test',
    });
    assert.equal(result.event, 'task.created');
  });

  it('skips type validation when no typeValidator', async () => {
    const bus = new EventBus(); // no typeValidator
    bus.setValidationMode('strict');
    bus.registerEventSchemas('tasks', [
      { name: 'task.created', schema: { taskId: 'uuid', title: 'string' } },
    ]);

    const result = await bus.publishAsync('task.created', { taskId: 42, title: 'Test' });
    assert.equal(result.event, 'task.created');
  });
});

describe('EventBus _validatePublish shared helper', () => {
  it('is a method on EventBus instances', () => {
    const bus = new EventBus();
    assert.equal(typeof bus._validatePublish, 'function');
  });

  it('is used by both publish() and publishAsync() (same behavior)', async () => {
    const tv = createMockTypeValidator();
    const bus = new EventBus({ typeValidator: tv });
    bus.setValidationMode('strict');
    bus.registerDeclaredEvents('tasks', ['task.created']);
    bus.registerEventSchemas('tasks', [
      { name: 'task.created', schema: { taskId: 'uuid' } },
    ]);

    // Both should throw the same ContractViolationError for undeclared events
    assert.throws(
      () => bus.publish('task.unknown', {}, { publisher: 'tasks' }),
      (err) => err.name === 'ContractViolationError'
    );

    await assert.rejects(
      () => bus.publishAsync('task.unknown', {}, { publisher: 'tasks' }),
      (err) => err.name === 'ContractViolationError'
    );
  });
});
