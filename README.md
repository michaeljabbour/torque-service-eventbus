# @torquedev/eventbus

Synchronous publish-subscribe event bus with optional SQLite durability and manifest-driven contract enforcement.

## Install

```bash
npm install @torquedev/eventbus
```

Or via git dependency:

```bash
npm install git+https://github.com/torque-framework/torque-service-eventbus.git
```

Peer dependency: `@torquedev/core`

## Usage

```js
import { EventBus } from '@torquedev/eventbus';

// In-memory mode (default)
const bus = new EventBus();

// Durable mode — persists events to SQLite
const bus = new EventBus({ db });

bus.subscribe('task:created', (payload) => {
  console.log('New task:', payload);
});

bus.publish('task:created', { id: '...', title: 'Ship it' }, { publisher: 'tasks' });
```

## API

### `EventBus`

| Method | Description |
|---|---|
| `constructor({ db, maxLogEntries, hookBus, silent })` | Create a bus. Pass `db` for SQLite durability; omit for an in-memory ring buffer (default 200 entries via `maxLogEntries`). |
| `setValidationMode(mode)` | Set contract enforcement: `'warn'` (log violations) or `'strict'` (throw `ContractViolationError`). |
| `registerDeclaredEvents(bundleName, events)` | Register which events a bundle is allowed to publish. |
| `registerEventSchemas(bundleName, schemas)` | Register payload field schemas for contract validation. |
| `publish(eventName, payload, { publisher })` | Publish an event. Validates publisher + payload against registered contracts. |
| `subscribe(eventName, handler)` | Subscribe to an event. |
| `subscriptions()` | List all active subscriptions. |
| `recentEvents(n)` | Return the last _n_ events from the ring buffer or database. |
| `queryEvents(eventName, { limit, since })` | Query stored events by name with optional time filtering. |

## Durability Modes

| Mode | Storage | Notes |
|---|---|---|
| **In-memory** (default) | Ring buffer | Capped at `maxLogEntries` (200). Fast, ephemeral. |
| **Durable** | SQLite `_kernel_events` table | Indexed columns, prepared statements for efficient writes and queries. |

## Contract Enforcement

The event bus validates that:

1. The **publisher** declared the event in its bundle manifest.
2. The **payload fields** match the registered schema.

| Mode | Behaviour |
|---|---|
| `warn` | Logs the violation, delivers the event anyway. |
| `strict` | Throws `ContractViolationError`, event is not delivered. |

## Type-Checked Payload Validation

Use `registerEventSchemas` to declare the expected payload shape for each event. The bus validates every published payload against the registered schema:

```js
bus.registerEventSchemas('tasks', {
  'task:created': {
    id:    { type: 'string', required: true },
    title: { type: 'string', required: true },
    done:  { type: 'boolean' },
  },
});

// Valid publish — all required fields present with correct types
bus.publish('task:created', { id: '1', title: 'Ship it', done: false }, { publisher: 'tasks' });

// Invalid publish — missing required field 'title'
// warn mode: logs warning, delivers event
// strict mode: throws ContractViolationError, event is NOT delivered
bus.publish('task:created', { id: '1' }, { publisher: 'tasks' });

// Invalid publish — wrong type for 'done' field
bus.publish('task:created', { id: '1', title: 'Ship it', done: 'yes' }, { publisher: 'tasks' });
```

### Publisher Enforcement

When `publish()` is called with a `{ publisher }` option, the bus checks that the publisher bundle declared the event in its manifest via `registerDeclaredEvents`. If the publisher is unknown or did not declare the event:

- **`warn` mode** -- A warning is logged to `console.warn`; the event is still delivered.
- **`strict` mode** -- A `ContractViolationError` is thrown and the event is not delivered to any subscriber.

Omitting the `publisher` option bypasses publisher enforcement entirely (useful for system-generated events or tests).

### `publishAsync`

A non-blocking variant of `publish` that schedules delivery via `setImmediate` and returns a `Promise`. Subscribers are called asynchronously after the current call stack unwinds, preventing slow or throwing subscribers from blocking the calling bundle.

```js
await bus.publishAsync('task:created', { id: '1', title: 'Ship it' }, { publisher: 'tasks' });
```

The same contract validation (schema + publisher checks) applies before scheduling. The returned `Promise` resolves after all subscribers have been called or rejects if contract validation fails in `strict` mode.

## Hook Integration

When a `hookBus` is provided, the event bus emits:

- `event:before-publish` — fired before an event is delivered to subscribers.
- `event:after-publish` — fired after all subscribers have been called.

## Details

- ESM-only
- Tests: `node --test`

## Torque Framework

Part of the [Torque](https://github.com/torque-framework/torque) composable monolith framework.

## License

MIT — see [LICENSE](./LICENSE)
