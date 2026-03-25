import { midiToNoteName } from '../types';

export class NoteDisplay {
  private container: HTMLElement;
  private element: HTMLElement;

  constructor(container: HTMLElement) {
    this.container = container;
    this.element = document.createElement('div');
    this.element.className = 'note-display';
    this.element.style.display = 'none';
    this.container.appendChild(this.element);
  }

  show(expectedMidis: number[], isChord: boolean): void {
    if (expectedMidis.length === 0) {
      this.hide();
      return;
    }

    const noteNames = expectedMidis.map(m => midiToNoteName(m));
    const label = isChord ? 'Chord' : 'Next';

    this.element.innerHTML = `
      <span class="nd-label">${label}</span>
      <span class="nd-notes">${noteNames.join(' + ')}</span>
    `;
    this.element.style.display = 'flex';
  }

  hide(): void {
    this.element.style.display = 'none';
  }

  destroy(): void {
    this.element.remove();
  }
}
