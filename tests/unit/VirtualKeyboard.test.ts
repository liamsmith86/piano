import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { VirtualKeyboard } from '../../src/input/VirtualKeyboard';
import { InputManager } from '../../src/input/InputManager';

describe('VirtualKeyboard', () => {
  let container: HTMLElement;
  let im: InputManager;
  let vk: VirtualKeyboard;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    im = new InputManager();
    vk = new VirtualKeyboard(container, im, 3, 4);
    vk.render();
  });

  afterEach(() => {
    vk.destroy();
    im.destroy();
    document.body.removeChild(container);
  });

  it('renders white and black keys', () => {
    const whiteKeys = container.querySelectorAll('.vk-white');
    const blackKeys = container.querySelectorAll('.vk-black');

    // 4 octaves * 7 white keys + 1 final C = 29
    expect(whiteKeys.length).toBe(29);
    // 4 octaves * 5 black keys = 20
    expect(blackKeys.length).toBe(20);
  });

  it('emits noteOn on mousedown', () => {
    const listener = vi.fn();
    im.addListener(listener);

    const firstKey = container.querySelector('.vk-white') as HTMLElement;
    firstKey.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));

    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'noteOn',
        source: 'virtual',
      }),
    );
  });

  it('emits noteOff on mouseup', () => {
    const listener = vi.fn();

    const firstKey = container.querySelector('.vk-white') as HTMLElement;
    firstKey.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));

    im.addListener(listener);
    firstKey.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));

    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'noteOff',
        source: 'virtual',
      }),
    );
  });

  it('highlightKeys adds highlight class', () => {
    const midi = 60; // C4 = (3+1)*12 + 0 = 48... wait, startOctave=3
    // startOctave=3, so first C is (3+1)*12 = 48, C3
    vk.highlightKeys([48]);

    const key = container.querySelector('[data-midi="48"]') as HTMLElement;
    expect(key?.classList.contains('vk-highlight')).toBe(true);
  });

  it('highlightKeys removes previous highlights', () => {
    vk.highlightKeys([48]);
    vk.highlightKeys([50]);

    const key48 = container.querySelector('[data-midi="48"]') as HTMLElement;
    const key50 = container.querySelector('[data-midi="50"]') as HTMLElement;
    expect(key48?.classList.contains('vk-highlight')).toBe(false);
    expect(key50?.classList.contains('vk-highlight')).toBe(true);
  });

  it('markCorrect adds and removes class', async () => {
    vi.useFakeTimers();
    vk.markCorrect(48);

    const key = container.querySelector('[data-midi="48"]') as HTMLElement;
    expect(key?.classList.contains('vk-correct')).toBe(true);

    vi.advanceTimersByTime(600);
    expect(key?.classList.contains('vk-correct')).toBe(false);
    vi.useRealTimers();
  });

  it('markWrong adds and removes class', async () => {
    vi.useFakeTimers();
    vk.markWrong(48);

    const key = container.querySelector('[data-midi="48"]') as HTMLElement;
    expect(key?.classList.contains('vk-wrong')).toBe(true);

    vi.advanceTimersByTime(600);
    expect(key?.classList.contains('vk-wrong')).toBe(false);
    vi.useRealTimers();
  });

  it('keys have data-midi attribute', () => {
    const keys = container.querySelectorAll('[data-midi]');
    expect(keys.length).toBeGreaterThan(0);

    const firstWhite = container.querySelector('.vk-white[data-midi]') as HTMLElement;
    const midiValue = parseInt(firstWhite.dataset.midi!);
    expect(midiValue).toBeGreaterThan(0);
  });

  it('destroy clears container', () => {
    vk.destroy();
    expect(container.innerHTML).toBe('');
  });
});
