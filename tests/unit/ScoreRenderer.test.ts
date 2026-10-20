import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDefaultScoreZoom, ScoreRenderer } from '../../src/score/ScoreRenderer';

describe('ScoreRenderer viewport behavior', () => {
  let animationFrameCallback: FrameRequestCallback | null;

  beforeEach(() => {
    animationFrameCallback = null;
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
      animationFrameCallback = callback;
      return 1;
    }));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses a fit-oriented desktop default while retaining the compact mobile default', () => {
    expect(getDefaultScoreZoom(1280)).toBe(1);
    expect(getDefaultScoreZoom(641)).toBe(1);
    expect(getDefaultScoreZoom(640)).toBe(0.75);
  });

  it('scrolls near the end of a line to reveal the next system before the wrap', () => {
    const container = document.createElement('div');
    Object.defineProperties(container, {
      clientHeight: { configurable: true, value: 400 },
      clientWidth: { configurable: true, value: 1000 },
      scrollHeight: { configurable: true, value: 1200 },
      scrollTop: { configurable: true, writable: true, value: 200 },
    });
    container.getBoundingClientRect = vi.fn(() => ({
      left: 100,
      top: 100,
      bottom: 500,
    } as DOMRect));
    container.scrollTo = vi.fn();

    const cursorElement = document.createElement('img');
    cursorElement.getBoundingClientRect = vi.fn(() => ({
      top: 250,
      bottom: 251,
      right: 850,
    } as DOMRect));

    const renderer = new ScoreRenderer(container);
    (renderer as unknown as { cursor: { cursorElement: HTMLElement } }).cursor = { cursorElement };

    renderer.scrollToCursor();
    animationFrameCallback?.(0);

    expect(container.scrollTo).toHaveBeenCalledWith({
      top: 238,
      behavior: 'auto',
    });
    renderer.destroy();
  });
});
