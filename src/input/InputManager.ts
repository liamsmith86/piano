import type { InputEvent } from '../types';

type InputListener = (event: InputEvent) => void;

export class InputManager {
  private listeners = new Set<InputListener>();
  private activeNotes = new Set<number>();

  addListener(callback: InputListener): void {
    this.listeners.add(callback);
  }

  removeListener(callback: InputListener): void {
    this.listeners.delete(callback);
  }

  emit(event: InputEvent): void {
    if (event.type === 'noteOn') {
      this.activeNotes.add(event.midiNumber);
    } else {
      this.activeNotes.delete(event.midiNumber);
    }
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (err) {
        console.error('Error in input listener:', err);
      }
    }
  }

  getActiveNotes(): Set<number> {
    return new Set(this.activeNotes);
  }

  isNoteActive(midiNumber: number): boolean {
    return this.activeNotes.has(midiNumber);
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
    // Release all active notes
    for (const note of this.activeNotes) {
      this.emit({
        type: 'noteOff',
        midiNumber: note,
        velocity: 0,
        source: 'programmatic',
      });
    }
    this.activeNotes.clear();
  }

  destroy(): void {
    this.clearAll();
    this.listeners.clear();
  }
}
