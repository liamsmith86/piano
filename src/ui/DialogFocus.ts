const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/** Keeps keyboard focus inside a modal and restores it when the modal closes. */
export class DialogFocus {
  private readonly previousFocus: HTMLElement | null;
  private readonly overlay: HTMLElement;
  private readonly dialog: HTMLElement;
  private readonly onDismiss: () => void;
  private active = true;

  constructor(
    overlay: HTMLElement,
    dialog: HTMLElement,
    onDismiss: () => void,
    initialFocus?: HTMLElement | null,
  ) {
    this.overlay = overlay;
    this.dialog = dialog;
    this.onDismiss = onDismiss;
    this.previousFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    this.overlay.addEventListener('keydown', this.handleKeyDown);
    (initialFocus ?? this.getFocusable()[0] ?? this.dialog).focus();
  }

  destroy(): void {
    if (!this.active) return;
    this.active = false;
    this.overlay.removeEventListener('keydown', this.handleKeyDown);
    if (this.previousFocus?.isConnected) this.previousFocus.focus();
  }

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.onDismiss();
      return;
    }
    if (event.key !== 'Tab') return;

    const focusable = this.getFocusable();
    if (focusable.length === 0) {
      event.preventDefault();
      this.dialog.focus();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !this.dialog.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };

  private getFocusable(): HTMLElement[] {
    return Array.from(this.dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
      .filter(element => !element.hidden && element.getAttribute('aria-hidden') !== 'true');
  }
}
