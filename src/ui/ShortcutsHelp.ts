export class ShortcutsHelp {
  private container: HTMLElement;
  private overlay: HTMLElement | null = null;

  constructor(container: HTMLElement) {
    this.container = container;
  }

  toggle(): void {
    if (this.overlay) {
      this.hide();
    } else {
      this.show();
    }
  }

  show(): void {
    this.hide();

    this.overlay = document.createElement('div');
    this.overlay.className = 'shortcuts-overlay';
    this.overlay.innerHTML = `
      <div class="shortcuts-panel">
        <div class="sh-header">
          <h2>Keyboard Shortcuts</h2>
          <button class="sh-close">&times;</button>
        </div>
        <div class="sh-grid">
          <div class="sh-section">
            <h3>Transport</h3>
            <div class="sh-row"><kbd>Space</kbd><span>Play / Pause / Start Practice</span></div>
            <div class="sh-row"><kbd>Escape</kbd><span>Stop</span></div>
            <div class="sh-row"><kbd>M</kbd><span>Toggle Metronome</span></div>
          </div>
          <div class="sh-section">
            <h3>Piano Keys (Lower Octave)</h3>
            <div class="sh-row"><kbd>Z</kbd><span>C3</span></div>
            <div class="sh-row"><kbd>S</kbd><span>C#3</span></div>
            <div class="sh-row"><kbd>X</kbd><span>D3</span></div>
            <div class="sh-row"><kbd>D</kbd><span>D#3</span></div>
            <div class="sh-row"><kbd>C</kbd><span>E3</span></div>
            <div class="sh-row"><kbd>V</kbd> - <kbd>M</kbd><span>F3 - B3</span></div>
          </div>
          <div class="sh-section">
            <h3>Piano Keys (Upper Octave)</h3>
            <div class="sh-row"><kbd>Q</kbd><span>C4</span></div>
            <div class="sh-row"><kbd>2</kbd><span>C#4</span></div>
            <div class="sh-row"><kbd>W</kbd><span>D4</span></div>
            <div class="sh-row"><kbd>3</kbd><span>D#4</span></div>
            <div class="sh-row"><kbd>E</kbd><span>E4</span></div>
            <div class="sh-row"><kbd>R</kbd> - <kbd>P</kbd><span>F4 - E5</span></div>
          </div>
          <div class="sh-section">
            <h3>General</h3>
            <div class="sh-row"><kbd>?</kbd><span>Show this help</span></div>
          </div>
        </div>
      </div>
    `;

    this.overlay.querySelector('.sh-close')!.addEventListener('click', () => this.hide());
    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) this.hide();
    });

    this.container.appendChild(this.overlay);
  }

  hide(): void {
    this.overlay?.remove();
    this.overlay = null;
  }
}
