import type { InputManager } from './InputManager';

// QWERTY keyboard to MIDI note mapping
// Lower row (Z-M): C3 to B3
// Upper row (Q-P): C4 to E5
// Black keys on S,D,G,H,J (lower) and 2,3,5,6,7 (upper)
const KEY_MAP: Record<string, number> = {
  // Lower octave (C3 = 48)
  'z': 48,  // C3
  's': 49,  // C#3
  'x': 50,  // D3
  'd': 51,  // D#3
  'c': 52,  // E3
  'v': 53,  // F3
  'g': 54,  // F#3
  'b': 55,  // G3
  'h': 56,  // G#3
  'n': 57,  // A3
  'j': 58,  // A#3
  'm': 59,  // B3
  ',': 60,  // C4 (overlap)

  // Upper octave (C4 = 60)
  'q': 60,  // C4
  '2': 61,  // C#4
  'w': 62,  // D4
  '3': 63,  // D#4
  'e': 64,  // E4
  'r': 65,  // F4
  '5': 66,  // F#4
  't': 67,  // G4
  '6': 68,  // G#4
  'y': 69,  // A4
  '7': 70,  // A#4
  'u': 71,  // B4
  'i': 72,  // C5
  '9': 73,  // C#5
  'o': 74,  // D5
  '0': 75,  // D#5
  'p': 76,  // E5
};

export class KeyboardInput {
  private inputManager: InputManager;
  private activeKeys = new Set<string>();
  private enabled = true;
  private handleKeyDown: (e: KeyboardEvent) => void;
  private handleKeyUp: (e: KeyboardEvent) => void;

  constructor(inputManager: InputManager) {
    this.inputManager = inputManager;

    this.handleKeyDown = (e: KeyboardEvent) => {
      if (!this.enabled) return;
      // Don't capture when typing in input fields
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      const key = e.key.toLowerCase();
      if (key in KEY_MAP && !this.activeKeys.has(key)) {
        e.preventDefault();
        this.activeKeys.add(key);
        this.inputManager.emit({
          type: 'noteOn',
          midiNumber: KEY_MAP[key],
          velocity: 0.7,
          source: 'keyboard',
        });
      }
    };

    this.handleKeyUp = (e: KeyboardEvent) => {
      if (!this.enabled) return;
      const key = e.key.toLowerCase();
      if (key in KEY_MAP && this.activeKeys.has(key)) {
        this.activeKeys.delete(key);
        this.inputManager.emit({
          type: 'noteOff',
          midiNumber: KEY_MAP[key],
          velocity: 0,
          source: 'keyboard',
        });
      }
    };
  }

  init(): void {
    document.addEventListener('keydown', this.handleKeyDown);
    document.addEventListener('keyup', this.handleKeyUp);
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.activeKeys.clear();
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  static getKeyMap(): Record<string, number> {
    return { ...KEY_MAP };
  }

  static getMidiForKey(key: string): number | undefined {
    return KEY_MAP[key.toLowerCase()];
  }

  destroy(): void {
    document.removeEventListener('keydown', this.handleKeyDown);
    document.removeEventListener('keyup', this.handleKeyUp);
    this.activeKeys.clear();
  }
}
