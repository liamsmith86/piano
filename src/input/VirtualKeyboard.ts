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
  private autoScroll = true;
  private highlightedNotes = new Set<number>();
  private activeNotes = new Set<number>();
  private pendingTimers = new Set<ReturnType<typeof setTimeout>>();
  private feedbackTimers = new Map<number, ReturnType<typeof setTimeout>>();
  private rendered = false;

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
    this.rendered = true;
    this.releaseActiveNotes();
    // Cancel any pending markCorrect/markWrong timers from previous render
    for (const id of this.pendingTimers) clearTimeout(id);
    this.pendingTimers.clear();
    this.feedbackTimers.clear();
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
    const key = document.createElement('button');
    key.type = 'button';
    key.className = `vk-key ${isBlack ? 'vk-black' : 'vk-white'}`;
    key.dataset.midi = String(midi);
    key.setAttribute('aria-label', `Piano key ${midiToNoteName(midi)}`);
    key.setAttribute('aria-pressed', 'false');
    key.tabIndex = midi === (this.startOctave + 1) * 12 ? 0 : -1;

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
        key.setAttribute('aria-pressed', 'true');
        this.inputManager.emit({
          type: 'noteOn',
          midiNumber: midi,
          velocity: 0.7,
          source: 'virtual',
          inputId: String(midi),
        });
      }
    };

    const noteOff = (e: Event) => {
      e.preventDefault();
      if (this.activeNotes.has(midi)) {
        this.activeNotes.delete(midi);
        key.classList.remove('vk-pressed');
        key.setAttribute('aria-pressed', 'false');
        this.inputManager.emit({
          type: 'noteOff',
          midiNumber: midi,
          velocity: 0,
          source: 'virtual',
          inputId: String(midi),
        });
      }
    };

    key.addEventListener('mousedown', noteOn);
    key.addEventListener('touchstart', noteOn, { passive: false });
    key.addEventListener('mouseup', noteOff);
    key.addEventListener('mouseleave', noteOff);
    key.addEventListener('touchend', noteOff);
    key.addEventListener('touchcancel', noteOff);

    key.addEventListener('focus', () => {
      for (const element of this.keyElements.values()) element.tabIndex = -1;
      key.tabIndex = 0;
    });
    key.addEventListener('keydown', event => {
      if (event.key === ' ' || event.key === 'Enter') {
        event.stopPropagation();
        if (!event.repeat) noteOn(event);
        return;
      }

      let targetMidi: number | null = null;
      if (event.key === 'ArrowLeft') targetMidi = midi - 1;
      else if (event.key === 'ArrowRight') targetMidi = midi + 1;
      else if (event.key === 'Home') targetMidi = Math.min(...this.keyElements.keys());
      else if (event.key === 'End') targetMidi = Math.max(...this.keyElements.keys());
      if (targetMidi === null) return;

      event.preventDefault();
      event.stopPropagation();
      this.keyElements.get(targetMidi)?.focus();
    });
    key.addEventListener('keyup', event => {
      if (event.key !== ' ' && event.key !== 'Enter') return;
      event.stopPropagation();
      noteOff(event);
    });

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
    if (this.autoScroll && midiNumbers.length > 0) {
      const midMidi = midiNumbers[Math.floor(midiNumbers.length / 2)];
      this.scrollToNote(midMidi);
    }
  }

  markCorrect(midi: number): void {
    this.showFeedback(midi, 'vk-correct');
  }

  markWrong(midi: number): void {
    this.showFeedback(midi, 'vk-wrong');
  }

  private showFeedback(midi: number, className: 'vk-correct' | 'vk-wrong'): void {
    const existingTimer = this.feedbackTimers.get(midi);
    if (existingTimer !== undefined) {
      clearTimeout(existingTimer);
      this.pendingTimers.delete(existingTimer);
    }
    const key = this.keyElements.get(midi);
    key?.classList.remove('vk-correct', 'vk-wrong');
    key?.classList.add(className);
    const id = setTimeout(() => {
      this.keyElements.get(midi)?.classList.remove(className);
      this.pendingTimers.delete(id);
      if (this.feedbackTimers.get(midi) === id) this.feedbackTimers.delete(midi);
    }, 500);
    this.pendingTimers.add(id);
    this.feedbackTimers.set(midi, id);
  }

  setShowNoteNames(show: boolean): void {
    if (show === this.showNoteNames) return;
    this.showNoteNames = show;
    if (this.rendered) this.render();
  }

  setAutoScroll(enabled: boolean): void {
    this.autoScroll = enabled;
  }

  scrollToNote(midi: number): void {
    const el = this.keyElements.get(midi);
    if (el?.scrollIntoView) {
      const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
      el.scrollIntoView({
        behavior: reduceMotion ? 'auto' : 'smooth',
        block: 'nearest',
        inline: 'center',
      });
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
      if (this.rendered) this.render();
    }
  }

  ensureRendered(): void {
    if (!this.rendered) this.render();
  }

  isRendered(): boolean {
    return this.rendered;
  }

  getRange(): { startOctave: number; numOctaves: number } {
    return { startOctave: this.startOctave, numOctaves: this.numOctaves };
  }

  destroy(): void {
    this.releaseActiveNotes();
    for (const id of this.pendingTimers) clearTimeout(id);
    this.pendingTimers.clear();
    this.feedbackTimers.clear();
    this.container.innerHTML = '';
    this.rendered = false;
    this.keyElements.clear();
    this.highlightedNotes.clear();
  }

  private releaseActiveNotes(): void {
    for (const midi of this.activeNotes) {
      this.inputManager.emit({
        type: 'noteOff',
        midiNumber: midi,
        velocity: 0,
        source: 'virtual',
        inputId: String(midi),
      });
    }
    this.activeNotes.clear();
  }
}
