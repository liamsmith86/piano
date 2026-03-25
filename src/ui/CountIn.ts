export class CountIn {
  private container: HTMLElement;
  private overlay: HTMLElement | null = null;

  constructor(container: HTMLElement) {
    this.container = container;
  }

  show(beat: number, total: number = 4): void {
    this.hide();

    this.overlay = document.createElement('div');
    this.overlay.className = 'count-in-overlay';
    this.overlay.innerHTML = `
      <div class="count-in-beat">${beat}</div>
      <div class="count-in-dots">
        ${Array.from({ length: total }, (_, i) =>
          `<span class="count-in-dot${i < beat ? ' active' : ''}"></span>`
        ).join('')}
      </div>
    `;

    this.container.appendChild(this.overlay);
  }

  hide(): void {
    this.overlay?.remove();
    this.overlay = null;
  }
}
