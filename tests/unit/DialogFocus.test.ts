import { afterEach, describe, expect, it, vi } from 'vitest';
import { DialogFocus } from '../../src/ui/DialogFocus';

describe('DialogFocus', () => {
  afterEach(() => document.body.replaceChildren());

  it('traps tab navigation and restores the previous focus', () => {
    const opener = document.createElement('button');
    const overlay = document.createElement('div');
    const dialog = document.createElement('div');
    const first = document.createElement('button');
    const last = document.createElement('button');
    dialog.append(first, last);
    overlay.appendChild(dialog);
    document.body.append(opener, overlay);
    opener.focus();

    const focus = new DialogFocus(overlay, dialog, vi.fn(), first);
    expect(document.activeElement).toBe(first);

    last.focus();
    last.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    expect(document.activeElement).toBe(first);

    first.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Tab', shiftKey: true, bubbles: true,
    }));
    expect(document.activeElement).toBe(last);

    focus.destroy();
    expect(document.activeElement).toBe(opener);
  });

  it('dismisses on Escape', () => {
    const overlay = document.createElement('div');
    const dialog = document.createElement('div');
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
    const dismiss = vi.fn();
    new DialogFocus(overlay, dialog, dismiss);

    dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(dismiss).toHaveBeenCalledOnce();
  });
});
