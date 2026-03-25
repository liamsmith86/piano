import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ScoreInteraction } from '../../src/score/ScoreInteraction';

function createMockRenderer() {
  return {
    getOSMD: vi.fn().mockReturnValue({
      graphic: {
        measureList: [
          [{ boundingBox: { AbsolutePosition: { x: 5, y: 17 }, Size: { width: 20, height: 6 } } }],
          [{ boundingBox: { AbsolutePosition: { x: 25, y: 17 }, Size: { width: 20, height: 6 } } }],
          [{ boundingBox: { AbsolutePosition: { x: 45, y: 17 }, Size: { width: 20, height: 6 } } }],
          [{ boundingBox: { AbsolutePosition: { x: 5, y: 37 }, Size: { width: 20, height: 6 } } }],
        ],
      },
    }),
    setCursorToMeasure: vi.fn(),
    cursorShow: vi.fn(),
  } as any;
}

function createMockContainer() {
  const container = document.createElement('div');
  // Create a mock SVG with viewBox
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 1000 500');
  container.appendChild(svg);

  // Mock getBoundingClientRect
  Object.defineProperty(container, 'getBoundingClientRect', {
    value: () => ({ left: 0, top: 0, right: 1000, bottom: 500, width: 1000, height: 500 }),
  });
  Object.defineProperty(svg, 'getBoundingClientRect', {
    value: () => ({ left: 0, top: 0, right: 1000, bottom: 500, width: 1000, height: 500 }),
  });
  Object.defineProperty(container, 'scrollLeft', { value: 0 });
  Object.defineProperty(container, 'scrollTop', { value: 0 });

  document.body.appendChild(container);
  return container;
}

describe('ScoreInteraction', () => {
  let container: HTMLElement;
  let renderer: any;
  let si: ScoreInteraction;

  beforeEach(() => {
    container = createMockContainer();
    renderer = createMockRenderer();
    si = new ScoreInteraction(container, renderer);
    si.init();
    si.buildMeasureMap();
  });

  it('builds measure map from OSMD graphic', () => {
    const regions = (si as any).measureRegions;
    expect(regions.length).toBe(4);
    expect(regions[0].measureNumber).toBe(1);
    expect(regions[1].measureNumber).toBe(2);
  });

  it('getSelection returns null initially', () => {
    expect(si.getSelection()).toBeNull();
  });

  it('clearSelection clears the selection', () => {
    // Manually set a selection
    (si as any).currentSelection = { startMeasure: 1, endMeasure: 3 };
    si.clearSelection();
    expect(si.getSelection()).toBeNull();
  });

  it('setOnSelect callback is callable', () => {
    const cb = vi.fn();
    si.setOnSelect(cb);
    expect(() => si.clearSelection()).not.toThrow();
  });

  it('setOnJump callback is callable', () => {
    const cb = vi.fn();
    si.setOnJump(cb);
    expect(() => si.clearSelection()).not.toThrow();
  });

  it('destroy removes event listeners without error', () => {
    expect(() => si.destroy()).not.toThrow();
  });

  it('builds empty map when no OSMD', () => {
    const emptyRenderer = { getOSMD: () => null } as any;
    const si2 = new ScoreInteraction(container, emptyRenderer);
    si2.buildMeasureMap();
    expect((si2 as any).measureRegions.length).toBe(0);
  });
});
