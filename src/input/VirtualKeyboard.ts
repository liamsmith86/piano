import type { InputManager } from './InputManager';
import { midiToNoteName } from '../types';

const WHITE_KEYS = [0, 2, 4, 5, 7, 9, 11]; // C, D, E, F, G, A, B
const BLACK_KEYS = [1, 3, 6, 8, 10]; // C#, D#, F#, G#, A#
const BLACK_KEY_OFFSETS: Record<number, number> = {
  1: 0.6,   // C#
  3: 1.7,   // D#
  6: 3.65,  // F#
  8: 4.7,   // G#
  10: 5.75, // A#
};

export class VirtualKeyboard {
  private container: HTMLElement;
  private inputManager: InputManager;
  private startOctave: number;
  private numOctaves: number;
  private keyElements = new Map<number, HTMLElement>();
  private showNoteNames = true;
  private highlightedNotes = new Set<number>();
  private activeNotes = new Set<number>();
  private pendingTimers = new Set<ReturnType<typeof setTimeout>>();

  constructor(
    container: HTMLElement,
    inputManager: InputManager,
    startOctave = 2,
    numOctaves = 5,
  ) {
    this.container = container;
    this.inputManager = inputManager;
    this.startOctave = startOctave;
    this.numOctaves = numOctaves;
  }

  render(): void {
    // Cancel any pending markCorrect/markWrong timers from previous render
    for (const id of this.pendingTimers) clearTimeout(id);
    this.pendingTimers.clear();
    this.container.innerHTML = '';
    this.container.classList.add('virtual-keyboard');
    this.keyElements.clear();

    const keyboard = document.createElement('div');
    keyboard.className = 'vk-keys';

    // Create white keys first, then overlay black keys
    const whiteKeyContainer = document.createElement('div');
    whiteKeyContainer.className = 'vk-white-keys';

    const blackKeyContainer = document.createElement('div');
    blackKeyContainer.className = 'vk-black-keys';

    for (let octave = this.startOctave; octave < this.startOctave + this.numOctaves; octave++) {
      for (const semitone of WHITE_KEYS) {
        const midi = (octave + 1) * 12 + semitone;
        const key = this.createKey(midi, false);
        whiteKeyContainer.appendChild(key);
        this.keyElements.set(midi, key);
      }
    }
    // Final C
    const finalC = (this.startOctave + this.numOctaves + 1) * 12;
    const finalKey = this.createKey(finalC, false);
    whiteKeyContainer.appendChild(finalKey);
    this.keyElements.set(finalC, finalKey);

    for (let octave = this.startOctave; octave < this.startOctave + this.numOctaves; octave++) {
      for (const semitone of BLACK_KEYS) {
        const midi = (octave + 1) * 12 + semitone;
        const offset = BLACK_KEY_OFFSETS[semitone];
        const whiteKeyWidth = 100 / (this.numOctaves * 7 + 1);
        const octaveOffset = (octave - this.startOctave) * 7;
        const leftPercent = (octaveOffset + offset) * whiteKeyWidth;

        const key = this.createKey(midi, true);
        key.style.left = `${leftPercent}%`;
        key.style.width = `${whiteKeyWidth * 0.65}%`;
        blackKeyContainer.appendChild(key);
        this.keyElements.set(midi, key);
      }
    }

    keyboard.appendChild(whiteKeyContainer);
    keyboard.appendChild(blackKeyContainer);
    this.container.appendChild(keyboard);
  }

  private createKey(midi: number, isBlack: boolean): HTMLElement {
    const key = document.createElement('div');
    key.className = `vk-key ${isBlack ? 'vk-black' : 'vk-white'}`;
    key.dataset.midi = String(midi);

    if (!isBlack) {
      const totalWhiteKeys = this.numOctaves * 7 + 1;
      key.style.width = `${100 / totalWhiteKeys}%`;
    }

    if (this.showNoteNames && !isBlack) {
      const label = document.createElement('span');
      label.className = 'vk-label';
      const name = midiToNoteName(midi);
      // Show only note letter + octave for white keys (no accidentals)
      label.textContent = name;
      key.appendChild(label);
    }

    // Mouse/touch events
    const noteOn = (e: Event) => {
      e.preventDefault();
      if (!this.activeNotes.has(midi)) {
        this.activeNotes.add(midi);
        key.classList.add('vk-pressed');
        this.inputManager.emit({
          type: 'noteOn',
          midiNumber: midi,
          velocity: 0.7,
          source: 'virtual',
        });
      }
    };

    const noteOff = (e: Event) => {
      e.preventDefault();
      if (this.activeNotes.has(midi)) {
        this.activeNotes.delete(midi);
        key.classList.remove('vk-pressed');
        this.inputManager.emit({
          type: 'noteOff',
          midiNumber: midi,
          velocity: 0,
          source: 'virtual',
        });
      }
    };

    key.addEventListener('mousedown', noteOn);
    key.addEventListener('touchstart', noteOn, { passive: false });
    key.addEventListener('mouseup', noteOff);
    key.addEventListener('mouseleave', noteOff);
    key.addEventListener('touchend', noteOff);
    key.addEventListener('touchcancel', noteOff);

    return key;
  }

  highlightKeys(midiNumbers: number[], staffByMidi?: Map<number, number>): void {
    // Clear old highlights
    for (const midi of this.highlightedNotes) {
      const el = this.keyElements.get(midi);
      el?.classList.remove('vk-highlight', 'vk-highlight-left');
    }
    this.highlightedNotes.clear();

    // Set new highlights — left hand (staff 2) gets a distinct color
    for (const midi of midiNumbers) {
      const el = this.keyElements.get(midi);
      if (el) {
        const staff = staffByMidi?.get(midi);
        el.classList.add(staff === 2 ? 'vk-highlight-left' : 'vk-highlight');
        this.highlightedNotes.add(midi);
      }
    }

    // Auto-scroll to the highlighted notes
    if (midiNumbers.length > 0) {
      const midMidi = midiNumbers[Math.floor(midiNumbers.length / 2)];
      this.scrollToNote(midMidi);
    }
  }

  markCorrect(midi: number): void {
    this.keyElements.get(midi)?.classList.add('vk-correct');
    const id = setTimeout(() => {
      this.keyElements.get(midi)?.classList.remove('vk-correct');
      this.pendingTimers.delete(id);
    }, 500);
    this.pendingTimers.add(id);
  }

  markWrong(midi: number): void {
    this.keyElements.get(midi)?.classList.add('vk-wrong');
    const id = setTimeout(() => {
      this.keyElements.get(midi)?.classList.remove('vk-wrong');
      this.pendingTimers.delete(id);
    }, 500);
    this.pendingTimers.add(id);
  }

  setShowNoteNames(show: boolean): void {
    this.showNoteNames = show;
    this.render(); // re-render
  }

  scrollToNote(midi: number): void {
    const el = this.keyElements.get(midi);
    if (el?.scrollIntoView) {
      el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }
  }

  adjustRangeForSong(midiNumbers: number[]): void {
    if (midiNumbers.length === 0) return;

    const minMidi = Math.min(...midiNumbers);
    const maxMidi = Math.max(...midiNumbers);

    // Convert to octaves with some padding
    const minOctave = Math.max(0, Math.floor(minMidi / 12) - 2); // -1 octave padding
    const maxOctave = Math.floor(maxMidi / 12) - 1;
    const newNumOctaves = Math.max(3, Math.min(7, maxOctave - minOctave + 2));

    if (minOctave !== this.startOctave || newNumOctaves !== this.numOctaves) {
      this.startOctave = minOctave;
      this.numOctaves = newNumOctaves;
      this.render();
    }
  }

  getRange(): { startOctave: number; numOctaves: number } {
    return { startOctave: this.startOctave, numOctaves: this.numOctaves };
  }

  destroy(): void {
    for (const id of this.pendingTimers) clearTimeout(id);
    this.pendingTimers.clear();
    this.container.innerHTML = '';
    this.keyElements.clear();
    this.highlightedNotes.clear();
    this.activeNotes.clear();
  }
}
