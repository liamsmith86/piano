import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { KeyboardInput } from '../../src/input/KeyboardInput';
import { InputManager } from '../../src/input/InputManager';

describe('KeyboardInput', () => {
  let im: InputManager;
  let ki: KeyboardInput;

  beforeEach(() => {
    im = new InputManager();
    ki = new KeyboardInput(im);
    ki.init();
  });

  afterEach(() => {
    ki.destroy();
    im.destroy();
  });

  it('maps Z key to C3 (MIDI 48)', () => {
    const listener = vi.fn();
    im.addListener(listener);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z' }));

    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'noteOn',
        midiNumber: 48,
        source: 'keyboard',
      }),
    );
  });

  it('maps Q key to C4 (MIDI 60)', () => {
    const listener = vi.fn();
    im.addListener(listener);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'q' }));

    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'noteOn',
        midiNumber: 60,
        source: 'keyboard',
      }),
    );
  });

  it('sends noteOff on keyup', () => {
    const listener = vi.fn();
    im.addListener(listener);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'q' }));
    document.dispatchEvent(new KeyboardEvent('keyup', { key: 'q' }));

    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenLastCalledWith(
      expect.objectContaining({
        type: 'noteOff',
        midiNumber: 60,
      }),
    );
  });

  it('does not repeat noteOn for held key', () => {
    const listener = vi.fn();
    im.addListener(listener);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'q' }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'q' }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'q' }));

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('ignores unmapped keys', () => {
    const listener = vi.fn();
    im.addListener(listener);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'f' }));

    expect(listener).not.toHaveBeenCalled();
  });

  it('does not fire when disabled', () => {
    const listener = vi.fn();
    im.addListener(listener);

    ki.setEnabled(false);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'q' }));

    expect(listener).not.toHaveBeenCalled();
  });

  it('re-enables correctly', () => {
    const listener = vi.fn();
    im.addListener(listener);

    ki.setEnabled(false);
    ki.setEnabled(true);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'q' }));

    expect(listener).toHaveBeenCalledOnce();
  });

  it('getKeyMap returns a copy of the key mapping', () => {
    const map = KeyboardInput.getKeyMap();
    expect(map['z']).toBe(48);
    expect(map['q']).toBe(60);
    expect(map['s']).toBe(49);  // C#3
  });

  it('getMidiForKey returns correct value', () => {
    expect(KeyboardInput.getMidiForKey('z')).toBe(48);
    expect(KeyboardInput.getMidiForKey('Q')).toBe(60); // case insensitive
    expect(KeyboardInput.getMidiForKey('f')).toBeUndefined();
  });

  it('maps black keys correctly', () => {
    const listener = vi.fn();
    im.addListener(listener);

    // S = C#3 (49)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 's' }));
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ midiNumber: 49 }),
    );

    // 2 = C#4 (61)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: '2' }));
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ midiNumber: 61 }),
    );
  });

  it('does not fire when typing in input fields', () => {
    const listener = vi.fn();
    im.addListener(listener);

    const input = document.createElement('input');
    document.body.appendChild(input);

    const event = new KeyboardEvent('keydown', { key: 'q' });
    Object.defineProperty(event, 'target', { value: input });
    document.dispatchEvent(event);

    expect(listener).not.toHaveBeenCalled();
    document.body.removeChild(input);
  });

  it('handles destroy correctly', () => {
    const listener = vi.fn();
    im.addListener(listener);

    ki.destroy();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'q' }));

    expect(listener).not.toHaveBeenCalled();
  });
});
