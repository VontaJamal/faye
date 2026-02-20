import crypto from "node:crypto";

export interface AppEvent {
  id: string;
  type: string;
  time: string;
  payload: Record<string, unknown>;
}

type Listener = (event: AppEvent) => void;

export class EventHub {
  private readonly listeners = new Set<Listener>();
  private readonly recent: AppEvent[] = [];

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

    for (const listener of this.listeners) {
      listener(event);
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
