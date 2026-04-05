import { ContractViolationError } from '@torquedev/core';

export class EventBus {
  /**
   * @param {object} opts
   * @param {object} [opts.db] - better-sqlite3 instance for durable persistence
   * @param {number} [opts.maxLogEntries] - max in-memory log entries (fallback when no db)
   */
  constructor({ db = null, maxLogEntries = 200, hookBus = null, typeValidator = null, silent = false } = {}) {
    this._silent = silent;
    this.subscribers = new Map();
    this.db = db;
    this.log = [];
    this.maxLogEntries = maxLogEntries;
    this._declaredEvents = new Map(); // bundleName -> Set of declared event names
    this._validationMode = 'warn'; // 'warn' | 'strict'
    this._eventSchemas = new Map(); // eventName -> { bundle, schema }
    this.hookBus = hookBus;
    this._typeValidator = typeValidator;

    if (this.db) {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS _kernel_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          event TEXT NOT NULL,
          payload TEXT NOT NULL,
          publisher TEXT,
          subscribers_notified INTEGER DEFAULT 0,
          error TEXT,
          created_at TEXT NOT NULL
        )
      `);
      this.db.exec(`CREATE INDEX IF NOT EXISTS idx_kernel_events_created ON _kernel_events(created_at)`);
      this.db.exec(`CREATE INDEX IF NOT EXISTS idx_kernel_events_event ON _kernel_events(event)`);

      this._insertStmt = this.db.prepare(`
        INSERT INTO _kernel_events (event, payload, publisher, subscribers_notified, error, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      this._recentStmt = this.db.prepare(
        `SELECT * FROM _kernel_events ORDER BY id DESC LIMIT ?`
      );
      // Pre-compiled query for queryEvents: since defaults to '0001-01-01' when null,
      // matching all records (all valid ISO timestamps are >= '0001-01-01').
      this._queryByEventStmt = this.db.prepare(
        `SELECT * FROM _kernel_events WHERE event = ? AND created_at >= COALESCE(?, '0001-01-01') ORDER BY id DESC LIMIT ?`
      );
      if (!this._silent) console.log('[eventbus] Durable mode: events persisted to _kernel_events table');
    }
  }

  /**
   * Set validation strictness: "warn" (log only) or "strict" (throw on violations).
   * Called by the kernel during boot from mount plan config.
   */
  setValidationMode(mode) {
    this._validationMode = mode;
  }

  /**
   * Report a contract violation. In "warn" mode, logs a warning.
   * In "strict" mode, throws a ContractViolationError.
   */
  _contractViolation(message) {
    if (this._validationMode === 'strict') {
      throw new ContractViolationError('event', message);
    }
    console.warn(`[contract] ${message}`);
  }

  /**
   * Shared validation for publish() and publishAsync().
   * Checks: undeclared event, payload field presence, extra fields, field types.
   */
  _validatePublish(eventName, payload, publisher) {
    // Check if publisher publishes an event not declared in its manifest
    if (publisher && this._declaredEvents.has(publisher)) {
      const declared = this._declaredEvents.get(publisher);
      if (!declared.has(eventName)) {
        this._contractViolation(
          `Bundle '${publisher}' published undeclared event '${eventName}'. ` +
          `Declared events: [${[...declared].join(', ')}]`
        );
      }
    }

    // Enforce publisher identity when any bundle has declared events
    if (!publisher && this._declaredEvents.size > 0) {
      this._contractViolation(
        `Event '${eventName}' published without publisher identifier. ` +
        `Pass { publisher: bundleName } for contract enforcement.`
      );
    }

    // Validate payload against declared schema
    if (this._eventSchemas.has(eventName) && payload) {
      const { schema, bundle } = this._eventSchemas.get(eventName);
      const declaredFields = Object.keys(schema);
      const actualFields = Object.keys(payload);
      for (const field of declaredFields) {
        if (!actualFields.includes(field)) {
          this._contractViolation(
            `Event '${eventName}' payload missing declared field '${field}'\n  Fix: add '${field}' to payload in ${bundle}/logic.js, or remove from events.publishes schema in manifest.yml`
          );
        } else if (this._typeValidator && payload[field] !== undefined) {
          const violation = this._typeValidator(schema[field], payload[field], field);
          if (violation) {
            this._contractViolation(
              `Event '${eventName}' payload type error: ${violation}`
            );
          }
        }
      }
      for (const field of actualFields) {
        if (!declaredFields.includes(field)) {
          this._contractViolation(
            `Event '${eventName}' payload has undeclared field '${field}'\n  Fix: add '${field}: ${typeof payload[field]}' to event schema in ${bundle}/manifest.yml`
          );
        }
      }
    }
  }

  /**
   * Register which events a bundle is allowed to publish (from manifest).
   * Called by the kernel during boot to enable undeclared-event warnings.
   */
  registerDeclaredEvents(bundleName, eventNames) {
    this._declaredEvents.set(bundleName, new Set(eventNames));
  }

  /**
   * Register event schemas for payload validation.
   * Called by the kernel during boot from manifest event declarations.
   */
  registerEventSchemas(bundleName, events) {
    for (const event of events) {
      if (event.name && event.schema) {
        this._eventSchemas.set(event.name, { bundle: bundleName, schema: event.schema });
      }
    }
  }

  publish(eventName, payload, { publisher = null } = {}) {
    this._validatePublish(eventName, payload, publisher);

    // Hook: before publish
    if (this.hookBus) {
      this.hookBus.emitSync('event:before-publish', { event: eventName, payload, publisher });
    }

    const entry = {
      event: eventName,
      payload,
      publisher,
      at: new Date().toISOString(),
      subscribers_notified: 0,
      errors: [],
    };

    const subs = this.subscribers.get(eventName) || [];
    for (const sub of subs) {
      try {
        const result = sub.handler(payload);
        if (result && typeof result.then === 'function') {
          // Async handler: fire-and-forget. Don't increment subscribers_notified
          // until the handler actually completes — use publishAsync() for that.
          result.catch(e => {
            entry.errors.push(`${sub.bundle}: ${e.message}`);
          });
        } else {
          entry.subscribers_notified++;
        }
      } catch (e) {
        entry.errors.push(`${sub.bundle}: ${e.message}`);
      }
    }

    // Persist to SQLite if available
    if (this.db) {
      try {
        this._insertStmt.run(
          eventName,
          JSON.stringify(payload),
          publisher,
          entry.subscribers_notified,
          entry.errors.length > 0 ? entry.errors.join('; ') : null,
          entry.at
        );
      } catch (e) {
        console.warn(`[eventbus] Failed to persist event: ${e.message}`);
      }
    }

    // Always keep in-memory log for fast access
    this.log.push(entry);
    if (this.log.length > this.maxLogEntries) {
      this.log.splice(0, this.log.length - this.maxLogEntries);
    }

    // Hook: after publish
    if (this.hookBus) {
      this.hookBus.emitSync('event:after-publish', { event: eventName, payload, publisher, subscribersNotified: entry.subscribers_notified });
    }

    return entry;
  }

  /**
   * Async variant of publish() that properly awaits each subscriber handler.
   * subscribers_notified is only incremented after the handler resolves.
   * Use this when you need backpressure or reliable error tracking for async handlers.
   */
  async publishAsync(eventName, payload, { publisher = null } = {}) {
    this._validatePublish(eventName, payload, publisher);

    // Hook: before publish
    if (this.hookBus) {
      this.hookBus.emitSync('event:before-publish', { event: eventName, payload, publisher });
    }

    const entry = {
      event: eventName,
      payload,
      publisher,
      at: new Date().toISOString(),
      subscribers_notified: 0,
      errors: [],
    };

    const subs = this.subscribers.get(eventName) || [];
    for (const sub of subs) {
      try {
        const result = sub.handler(payload);
        if (result && typeof result.then === 'function') {
          try {
            await result;
          } catch (e) {
            entry.errors.push(`${sub.bundle}: ${e.message}`);
          }
        }
        entry.subscribers_notified++;
      } catch (e) {
        entry.errors.push(`${sub.bundle}: ${e.message}`);
      }
    }

    // Persist to SQLite if available
    if (this.db) {
      try {
        this._insertStmt.run(
          eventName,
          JSON.stringify(payload),
          publisher,
          entry.subscribers_notified,
          entry.errors.length > 0 ? entry.errors.join('; ') : null,
          entry.at
        );
      } catch (e) {
        console.warn(`[eventbus] Failed to persist event: ${e.message}`);
      }
    }

    // Always keep in-memory log for fast access
    this.log.push(entry);
    if (this.log.length > this.maxLogEntries) {
      this.log.splice(0, this.log.length - this.maxLogEntries);
    }

    // Hook: after publish
    if (this.hookBus) {
      this.hookBus.emitSync('event:after-publish', { event: eventName, payload, publisher, subscribersNotified: entry.subscribers_notified });
    }

    return entry;
  }

  subscribe(eventName, bundleName, handler) {
    if (!this.subscribers.has(eventName)) this.subscribers.set(eventName, []);
    this.subscribers.get(eventName).push({ bundle: bundleName, handler });
  }

  subscriptions() {
    const result = {};
    for (const [event, subs] of this.subscribers) {
      result[event] = subs.map(s => s.bundle);
    }
    return result;
  }

  recentEvents(n = 20) {
    if (this.db) {
      return this._recentStmt.all(n).reverse().map(row => ({
        event: row.event,
        payload: JSON.parse(row.payload),
        publisher: row.publisher,
        at: row.created_at,
        subscribers_notified: row.subscribers_notified,
        errors: row.error ? row.error.split('; ') : [],
      }));
    }
    return this.log.slice(-n);
  }

  /**
   * Query persisted events by name (durable mode only).
   */
  queryEvents(eventName, { limit = 50, since = null } = {}) {
    if (!this.db) return [];
    return this._queryByEventStmt.all(eventName, since, limit).reverse().map(row => ({
      event: row.event,
      payload: JSON.parse(row.payload),
      publisher: row.publisher,
      at: row.created_at,
      subscribers_notified: row.subscribers_notified,
    }));
  }
}
