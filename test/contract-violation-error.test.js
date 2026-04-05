/**
 * Tests for EventBus._contractViolation() using formal ContractViolationError class (task-3).
 * Verifies that strict mode throws ContractViolationError (not plain Error).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EventBus } from '../index.js';
import { ContractViolationError } from '@torquedev/core';

describe('EventBus._contractViolation() - ContractViolationError', () => {
  it('throws ContractViolationError (not plain Error) in strict mode', () => {
    const bus = new EventBus();
    bus.setValidationMode('strict');

    assert.throws(
      () => bus._contractViolation('undeclared event published'),
      (err) => {
        assert.ok(
          err instanceof ContractViolationError,
          `Expected ContractViolationError, got ${err.constructor.name}`
        );
        assert.equal(err.name, 'ContractViolationError');
        assert.equal(err.code, 'CONTRACT_VIOLATION');
        return true;
      }
    );
  });

  it('ContractViolationError has tag=event and violationMessage matches input', () => {
    const bus = new EventBus();
    bus.setValidationMode('strict');

    assert.throws(
      () => bus._contractViolation('some violation message'),
      (err) => {
        assert.equal(err.tag, 'event');
        assert.equal(err.violationMessage, 'some violation message');
        return true;
      }
    );
  });

  it('does not throw ContractViolationError in warn mode', () => {
    const bus = new EventBus();
    bus.setValidationMode('warn');

    const warns = [];
    const origWarn = console.warn;
    console.warn = (...args) => warns.push(args);
    try {
      assert.doesNotThrow(() => bus._contractViolation('some warning'));
      assert.equal(warns.length, 1, 'expected console.warn to be called once');
    } finally {
      console.warn = origWarn;
    }
  });

  it('publish in strict mode throws ContractViolationError for undeclared event', () => {
    const bus = new EventBus();
    bus.setValidationMode('strict');
    bus.registerDeclaredEvents('myBundle', ['declared.event']);

    assert.throws(
      () => bus.publish('undeclared.event', {}, { publisher: 'myBundle' }),
      (err) => {
        assert.ok(
          err instanceof ContractViolationError,
          `Expected ContractViolationError, got ${err.constructor.name}`
        );
        assert.equal(err.code, 'CONTRACT_VIOLATION');
        return true;
      }
    );
  });
});
