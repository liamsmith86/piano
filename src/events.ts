import type { AppEventMap, AppEventName } from './types';

type Listener<T> = (data: T) => void;

export class EventEmitter {
  private listeners = new Map<string, Set<Listener<any>>>();

  on<K extends AppEventName>(event: K, callback: Listener<AppEventMap[K]>): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback);
  }

  off<K extends AppEventName>(event: K, callback: Listener<AppEventMap[K]>): void {
    this.listeners.get(event)?.delete(callback);
  }

  emit<K extends AppEventName>(event: K, data: AppEventMap[K]): void {
    this.listeners.get(event)?.forEach(cb => {
      try {
        cb(data);
      } catch (err) {
        console.error(`Error in event listener for ${event}:`, err);
      }
    });
  }

  removeAllListeners(event?: AppEventName): void {
    if (event) {
      this.listeners.delete(event);
    } else {
      this.listeners.clear();
    }
  }

  listenerCount(event: AppEventName): number {
    return this.listeners.get(event)?.size ?? 0;
  }
}
