import type { ScoreRenderer } from './ScoreRenderer';

export interface MeasureRegion {
  measureNumber: number;
  left: number;   // pixels relative to score container
  top: number;
  right: number;
  bottom: number;
}

export interface ScoreSelection {
  startMeasure: number;
  endMeasure: number;
}

type SelectionCallback = (selection: ScoreSelection | null) => void;
type JumpCallback = (measureNumber: number) => void;

export class ScoreInteraction {
  private container: HTMLElement;
  private renderer: ScoreRenderer;
  private measureRegions: MeasureRegion[] = [];
  private selectionOverlay: HTMLElement;
  private selectionHighlight: HTMLElement;

  private isDragging = false;
  private dragStartMeasure: number | null = null;
  private currentSelection: ScoreSelection | null = null;

  private onSelect: SelectionCallback | null = null;
  private onJump: JumpCallback | null = null;

  private handlePointerDown: (e: PointerEvent) => void;
  private handlePointerMove: (e: PointerEvent) => void;
  private handlePointerUp: (e: PointerEvent) => void;

  constructor(container: HTMLElement, renderer: ScoreRenderer) {
    this.container = container;
    this.renderer = renderer;

    // Selection overlay
    this.selectionOverlay = document.createElement('div');
    this.selectionOverlay.className = 'score-selection-overlay';
    this.container.appendChild(this.selectionOverlay);

    // Highlight element
    this.selectionHighlight = document.createElement('div');
    this.selectionHighlight.className = 'score-selection-highlight';
    this.selectionHighlight.style.display = 'none';
    this.selectionOverlay.appendChild(this.selectionHighlight);

    // Pointer events (work for both mouse and touch)
    this.handlePointerDown = (e: PointerEvent) => {
      const measure = this.getMeasureAtPoint(e.clientX, e.clientY);
      if (measure === null) return;

      this.isDragging = true;
      this.dragStartMeasure = measure;
      this.currentSelection = null;
      this.updateSelectionVisual(measure, measure);
      this.container.setPointerCapture(e.pointerId);
      e.preventDefault();
    };

    this.handlePointerMove = (e: PointerEvent) => {
      if (!this.isDragging || this.dragStartMeasure === null) return;

      const measure = this.getMeasureAtPoint(e.clientX, e.clientY);
      if (measure === null) return;

      const start = Math.min(this.dragStartMeasure, measure);
      const end = Math.max(this.dragStartMeasure, measure);
      this.updateSelectionVisual(start, end);
      e.preventDefault();
    };

    this.handlePointerUp = (e: PointerEvent) => {
      if (!this.isDragging || this.dragStartMeasure === null) return;

      const measure = this.getMeasureAtPoint(e.clientX, e.clientY);
      this.isDragging = false;

      if (measure === null) {
        this.clearSelection();
        return;
      }

      const start = Math.min(this.dragStartMeasure, measure);
      const end = Math.max(this.dragStartMeasure, measure);

      if (start === end) {
        // Single click — jump to measure
        this.clearSelection();
        this.onJump?.(start);
      } else {
        // Drag — select range
        this.currentSelection = { startMeasure: start, endMeasure: end };
        this.updateSelectionVisual(start, end);
        this.onSelect?.(this.currentSelection);
      }

      this.dragStartMeasure = null;
      this.container.releasePointerCapture(e.pointerId);
    };
  }

  init(): void {
    this.container.addEventListener('pointerdown', this.handlePointerDown);
    this.container.addEventListener('pointermove', this.handlePointerMove);
    this.container.addEventListener('pointerup', this.handlePointerUp);
  }

  buildMeasureMap(): void {
    this.measureRegions = [];
    const osmd = this.renderer.getOSMD() as any;
    if (!osmd?.graphic?.measureList) return;

    const containerRect = this.container.getBoundingClientRect();
    const measureList = osmd.graphic.measureList;

    // OSMD units to pixel scale: find the SVG element and compute scale
    const svg = this.container.querySelector('svg');
    if (!svg) return;
    const svgRect = svg.getBoundingClientRect();
    const svgViewBox = svg.getAttribute('viewBox');
    let scaleX = 1, scaleY = 1, svgOffsetX = 0, svgOffsetY = 0;

    if (svgViewBox) {
      const parts = svgViewBox.split(/\s+/).map(Number);
      scaleX = svgRect.width / parts[2];
      scaleY = svgRect.height / parts[3];
      svgOffsetX = svgRect.left - containerRect.left + this.container.scrollLeft;
      svgOffsetY = svgRect.top - containerRect.top + this.container.scrollTop;
    }

    for (let mIdx = 0; mIdx < measureList.length; mIdx++) {
      const staffMeasures = measureList[mIdx];
      if (!staffMeasures?.[0]?.boundingBox) continue;

      // Get bounding box from first staff, expand to include all staves
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

      for (const gm of staffMeasures) {
        if (!gm?.boundingBox) continue;
        const bbox = gm.boundingBox;
        const pos = bbox.AbsolutePosition;
        const size = bbox.Size;

        const x = pos.x * 10 * scaleX + svgOffsetX;
        const y = pos.y * 10 * scaleY + svgOffsetY;
        const w = size.width * 10 * scaleX;
        const h = size.height * 10 * scaleY;

        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x + w);
        maxY = Math.max(maxY, y + h);
      }

      if (minX !== Infinity) {
        this.measureRegions.push({
          measureNumber: mIdx + 1,
          left: minX,
          top: minY,
          right: maxX,
          bottom: maxY,
        });
      }
    }
  }

  private getMeasureAtPoint(clientX: number, clientY: number): number | null {
    const containerRect = this.container.getBoundingClientRect();
    const x = clientX - containerRect.left + this.container.scrollLeft;
    const y = clientY - containerRect.top + this.container.scrollTop;

    // Find the closest measure to this point
    let bestMeasure: number | null = null;
    let bestDist = Infinity;

    for (const region of this.measureRegions) {
      // Check if point is within the vertical band of this measure's system
      if (y >= region.top - 20 && y <= region.bottom + 20) {
        // Check horizontal overlap
        if (x >= region.left - 5 && x <= region.right + 5) {
          const centerX = (region.left + region.right) / 2;
          const centerY = (region.top + region.bottom) / 2;
          const dist = Math.abs(x - centerX) + Math.abs(y - centerY);
          if (dist < bestDist) {
            bestDist = dist;
            bestMeasure = region.measureNumber;
          }
        }
      }
    }

    return bestMeasure;
  }

  // Reusable DOM elements to avoid flicker from constant create/destroy
  private rectPool: HTMLElement[] = [];
  private labelEl: HTMLElement | null = null;
  private activeRects = 0;

  private updateSelectionVisual(startMeasure: number, endMeasure: number): void {
    // Find all measure regions in the range
    const regions = this.measureRegions.filter(
      r => r.measureNumber >= startMeasure && r.measureNumber <= endMeasure
    );

    if (regions.length === 0) {
      this.hideAllVisuals();
      return;
    }

    // Group by system line (same top position ± tolerance)
    const systems = new Map<number, MeasureRegion[]>();
    for (const r of regions) {
      const systemKey = Math.round(r.top / 50) * 50;
      if (!systems.has(systemKey)) systems.set(systemKey, []);
      systems.get(systemKey)!.push(r);
    }

    // Update or create highlight rectangles for each system line
    let rectIdx = 0;
    for (const [, sysRegions] of systems) {
      const minLeft = Math.min(...sysRegions.map(r => r.left));
      const maxRight = Math.max(...sysRegions.map(r => r.right));
      const minTop = Math.min(...sysRegions.map(r => r.top));
      const maxBottom = Math.max(...sysRegions.map(r => r.bottom));

      let rect = this.rectPool[rectIdx];
      if (!rect) {
        rect = document.createElement('div');
        rect.className = 'score-selection-rect';
        this.selectionOverlay.appendChild(rect);
        this.rectPool.push(rect);
      }
      rect.style.left = `${minLeft - 4}px`;
      rect.style.top = `${minTop - 4}px`;
      rect.style.width = `${maxRight - minLeft + 8}px`;
      rect.style.height = `${maxBottom - minTop + 8}px`;
      rect.style.display = '';
      rectIdx++;
    }

    // Hide any excess rects from previous frames
    for (let i = rectIdx; i < this.activeRects; i++) {
      this.rectPool[i].style.display = 'none';
    }
    this.activeRects = rectIdx;

    // Update or create label
    if (startMeasure !== endMeasure) {
      if (!this.labelEl) {
        this.labelEl = document.createElement('div');
        this.labelEl.className = 'score-selection-label';
        this.selectionOverlay.appendChild(this.labelEl);
      }
      const firstRegion = regions[0];
      this.labelEl.style.left = `${firstRegion.left}px`;
      this.labelEl.style.top = `${firstRegion.top - 24}px`;
      this.labelEl.style.display = '';
      this.labelEl.textContent = `Measures ${startMeasure}–${endMeasure}`;
    } else if (this.labelEl) {
      this.labelEl.style.display = 'none';
    }
  }

  private hideAllVisuals(): void {
    for (let i = 0; i < this.activeRects; i++) {
      this.rectPool[i].style.display = 'none';
    }
    this.activeRects = 0;
    if (this.labelEl) this.labelEl.style.display = 'none';
  }

  clearSelection(): void {
    this.currentSelection = null;
    this.hideAllVisuals();
  }

  getSelection(): ScoreSelection | null {
    return this.currentSelection;
  }

  setOnSelect(cb: SelectionCallback): void {
    this.onSelect = cb;
  }

  setOnJump(cb: JumpCallback): void {
    this.onJump = cb;
  }

  destroy(): void {
    this.container.removeEventListener('pointerdown', this.handlePointerDown);
    this.container.removeEventListener('pointermove', this.handlePointerMove);
    this.container.removeEventListener('pointerup', this.handlePointerUp);
    this.selectionOverlay.remove();
  }
}
