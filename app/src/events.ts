import crypto from "node:crypto";

export interface AppEvent {
  id: string;
  type: string;
  time: string;
  payload: Record<string, unknown>;
}

type Listener = (event: AppEvent) => void;
type ListenerErrorReporter = (details: { error: unknown; event: AppEvent }) => void;

export class EventHub {
  private readonly listeners = new Set<Listener>();
  private readonly recent: AppEvent[] = [];
  constructor(private readonly onListenerError?: ListenerErrorReporter) {}

  publish(type: string, payload: Record<string, unknown>): AppEvent {
    const event: AppEvent = {
      id: crypto.randomUUID(),
      type,
      time: new Date().toISOString(),
      payload
    };

    this.recent.push(event);
    if (this.recent.length > 100) {
      this.recent.shift();
    }

    for (const listener of [...this.listeners]) {
      try {
        listener(event);
      } catch (error) {
        this.onListenerError?.({ error, event });
        // Keep event fanout resilient: one bad listener must not block the others.
      }
    }

    return event;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  recentEvents(): AppEvent[] {
    return [...this.recent];
  }
}
