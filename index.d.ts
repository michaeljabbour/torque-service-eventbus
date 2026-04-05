/**
 * @torquedev/eventbus - TypeScript declarations
 */

export interface EventEntry {
  event: string;
  payload: unknown;
  publisher: string | null;
  at: string;
  subscribers_notified: number;
  errors: string[];
}

export declare class EventBus {
  constructor(opts?: {
    db?: object | null;
    maxLogEntries?: number;
    hookBus?: object | null;
    typeValidator?: ((schema: unknown, value: unknown, field: string) => string | null) | null;
    silent?: boolean;
  });

  setValidationMode(mode: 'warn' | 'strict'): void;

  registerDeclaredEvents(bundleName: string, eventNames: string[]): void;

  registerEventSchemas(
    bundleName: string,
    events: Array<{ name: string; schema?: Record<string, string> }>
  ): void;

  publish(
    eventName: string,
    payload: unknown,
    opts?: { publisher?: string | null }
  ): EventEntry;

  publishAsync(
    eventName: string,
    payload: unknown,
    opts?: { publisher?: string | null }
  ): Promise<EventEntry>;

  subscribe(
    eventName: string,
    bundleName: string,
    handler: (payload: unknown) => unknown | Promise<unknown>
  ): void;

  subscriptions(): Record<string, string[]>;

  recentEvents(n?: number): EventEntry[];

  queryEvents(
    eventName: string,
    opts?: { limit?: number; since?: string | null }
  ): EventEntry[];
}
