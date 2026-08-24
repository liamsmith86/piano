import type { InputEvent } from '../types';

type InputListener = (event: InputEvent) => void;

export class InputManager {
  private listeners = new Set<InputListener>();
  private activeInputsByNote = new Map<number, Set<string>>();

  addListener(callback: InputListener): void {
    this.listeners.add(callback);
  }

  removeListener(callback: InputListener): void {
    this.listeners.delete(callback);
  }

  emit(event: InputEvent): void {
    const inputId = this.getInputId(event);
    if (event.type === 'noteOn') {
      const activeInputs = this.activeInputsByNote.get(event.midiNumber) ?? new Set<string>();
      activeInputs.add(inputId);
      this.activeInputsByNote.set(event.midiNumber, activeInputs);
    } else {
      const activeInputs = this.activeInputsByNote.get(event.midiNumber);
      activeInputs?.delete(inputId);
      if (activeInputs?.size === 0) {
        this.activeInputsByNote.delete(event.midiNumber);
      }
    }
    this.notifyListeners(event);
  }

  private getInputId(event: InputEvent): string {
    return `${event.source}:${event.inputId ?? event.midiNumber}`;
  }

  private notifyListeners(event: InputEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (err) {
        console.error('Error in input listener:', err);
      }
    }
  }

  getActiveNotes(): Set<number> {
    return new Set(this.activeInputsByNote.keys());
  }

  isNoteActive(midiNumber: number): boolean {
    return this.activeInputsByNote.has(midiNumber);
  }

  // Programmatic input for testing
  simulateNoteOn(midiNumber: number, velocity: number = 100): void {
    this.emit({
      type: 'noteOn',
      midiNumber,
      velocity,
      source: 'programmatic',
    });
  }

  simulateNoteOff(midiNumber: number): void {
    this.emit({
      type: 'noteOff',
      midiNumber,
      velocity: 0,
      source: 'programmatic',
    });
  }

  clearAll(): void {
    const activeNotes = [...this.activeInputsByNote.keys()];
    this.activeInputsByNote.clear();
    for (const note of activeNotes) {
      this.notifyListeners({
        type: 'noteOff',
        midiNumber: note,
        velocity: 0,
        source: 'programmatic',
      });
    }
  }

  destroy(): void {
    this.clearAll();
    this.listeners.clear();
  }
}
