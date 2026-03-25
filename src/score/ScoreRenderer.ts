import { OpenSheetMusicDisplay, Cursor } from 'opensheetmusicdisplay';
import type { IOSMDOptions } from 'opensheetmusicdisplay';
import type { HandSelection } from '../types';

export class ScoreRenderer {
  private osmd: OpenSheetMusicDisplay | null = null;
  private cursor: Cursor | null = null;
  private container: HTMLElement;
  private currentHand: HandSelection = 'both';
  private wrongNoteOverlay: SVGSVGElement | null = null;
  private pendingTimers = new Set<ReturnType<typeof setTimeout>>();

  constructor(container: HTMLElement) {
    this.container = container;
  }

  async load(source: string | ArrayBuffer): Promise<void> {
    // Clean up previous instance to prevent memory leaks
    this.clearNoteHighlights();
    this.wrongNoteOverlay?.remove();
    this.wrongNoteOverlay = null;
    for (const id of this.pendingTimers) clearTimeout(id);
    this.pendingTimers.clear();
    if (this.osmd) {
      this.osmd.clear();
      this.osmd = null;
      this.cursor = null;
    }

    // Ensure container is visible for OSMD to calculate dimensions
    this.container.style.display = 'block';
    if (this.container.offsetWidth === 0) {
      this.container.style.minWidth = '800px';
    }

    const options: IOSMDOptions = {
      autoResize: true,
      backend: 'svg',
      drawTitle: true,
      drawSubtitle: true,
      drawComposer: true,
      drawCredits: false,
      drawPartNames: false,
      drawPartAbbreviations: false,
      drawMeasureNumbers: true,
      drawTimeSignatures: true,
      drawMetronomeMarks: true,
      followCursor: true,
      cursorsOptions: [{
        type: 0,
        color: '#3b82f6',
        alpha: 0.4,
        follow: true,
      }],
    };

    this.osmd = new OpenSheetMusicDisplay(this.container, options);

    if (typeof source === 'string') {
      await this.osmd.load(source);
    } else {
      // ArrayBuffer from file upload
      const header = new Uint8Array(source.slice(0, 4));
      if (header[0] === 0x50 && header[1] === 0x4B) {
        // MXL (ZIP) file — pass as base64
        const bytes = new Uint8Array(source);
        let binary = '';
        bytes.forEach(b => binary += String.fromCharCode(b));
        const base64 = btoa(binary);
        const mxlDataUrl = `data:application/vnd.recordare.musicxml+xml;base64,${base64}`;
        await this.osmd.load(mxlDataUrl);
      } else {
        // Plain XML
        const xml = new TextDecoder('utf-8').decode(source);
        await this.osmd.load(xml);
      }
    }

    this.osmd.render();
    this.setupCursor();
    this.setupWrongNoteOverlay();
    this.applyHandColoring();
  }

  private setupCursor(): void {
    if (!this.osmd) return;
    this.cursor = this.osmd.cursors[0];
    if (this.cursor) {
      this.cursor.show();
      this.cursor.reset();
    }
  }

  private setupWrongNoteOverlay(): void {
    this.wrongNoteOverlay?.remove();

    const overlay = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    overlay.setAttribute('class', 'wrong-note-overlay');
    overlay.style.position = 'absolute';
    overlay.style.top = '0';
    overlay.style.left = '0';
    overlay.style.width = '100%';
    overlay.style.height = '100%';
    overlay.style.pointerEvents = 'none';
    overlay.style.overflow = 'visible';

    this.container.style.position = 'relative';
    this.container.appendChild(overlay);
    this.wrongNoteOverlay = overlay;
  }

  applyHandColoring(): void {
    this.container.classList.remove('hand-both', 'hand-left', 'hand-right');
    this.container.classList.add(`hand-${this.currentHand}`);
  }

  // --- Note coloring for practice/play mode ---

  private coloredElements: { el: SVGElement; origFill: string | null; origStroke: string | null }[] = [];

  /** Color the noteheads at the current cursor position */
  highlightCurrentNotes(color: string): void {
    this.clearNoteHighlights();
    if (!this.cursor) return;

    const gnotes = (this.cursor as any).GNotesUnderCursor?.();
    if (!gnotes) return;

    for (const gn of gnotes) {
      try {
        const svgEl = gn.getSVGGElement?.() as SVGGElement | null;
        if (svgEl) {
          svgEl.querySelectorAll('path, circle, ellipse').forEach((el: Element) => {
            const svgPath = el as SVGElement;
            this.coloredElements.push({
              el: svgPath,
              origFill: svgPath.getAttribute('fill'),
              origStroke: svgPath.getAttribute('stroke'),
            });
            if (svgPath.getAttribute('fill') && svgPath.getAttribute('fill') !== 'none') {
              svgPath.setAttribute('fill', color);
            }
            if (svgPath.getAttribute('stroke') && svgPath.getAttribute('stroke') !== 'none') {
              svgPath.setAttribute('stroke', color);
            }
          });
        }
      } catch {}
    }
  }

  /** Mark notes at the current position as played (green) */
  markNotesPlayed(): void {
    // Keep references to played notes (don't clear them, let them stay green)
    if (!this.cursor) return;

    const gnotes = (this.cursor as any).GNotesUnderCursor?.();
    if (!gnotes) return;

    for (const gn of gnotes) {
      try {
        const svgEl = gn.getSVGGElement?.() as SVGGElement | null;
        if (svgEl) {
          svgEl.querySelectorAll('path, circle, ellipse').forEach((el: Element) => {
            const svgPath = el as SVGElement;
            if (svgPath.getAttribute('fill') && svgPath.getAttribute('fill') !== 'none') {
              svgPath.setAttribute('fill', '#22c55e');
            }
            if (svgPath.getAttribute('stroke') && svgPath.getAttribute('stroke') !== 'none') {
              svgPath.setAttribute('stroke', '#22c55e');
            }
          });
        }
      } catch {}
    }
  }

  /** Scroll the container to keep the cursor element visible */
  scrollToCursor(): void {
    const cursorEl = this.cursor?.cursorElement;
    if (!cursorEl) return;

    const containerRect = this.container.getBoundingClientRect();
    const cursorRect = cursorEl.getBoundingClientRect();

    // Check if cursor is below the visible area
    const cursorBottom = cursorRect.bottom - containerRect.top;
    const visibleHeight = this.container.clientHeight;

    if (cursorBottom > visibleHeight - 40 || cursorRect.top < containerRect.top + 20) {
      // Scroll to center the cursor
      const scrollTarget = this.container.scrollTop + cursorRect.top - containerRect.top - visibleHeight / 3;
      this.container.scrollTo({
        top: Math.max(0, scrollTarget),
        behavior: 'smooth',
      });
    }
  }

  /** Clear note color highlights (restore original colors) */
  clearNoteHighlights(): void {
    for (const { el, origFill, origStroke } of this.coloredElements) {
      if (origFill === null) el.removeAttribute('fill');
      else el.setAttribute('fill', origFill);
      if (origStroke === null) el.removeAttribute('stroke');
      else el.setAttribute('stroke', origStroke);
    }
    this.coloredElements = [];
  }

  setHand(hand: HandSelection): void {
    this.currentHand = hand;
    this.applyHandColoring();
  }

  getHand(): HandSelection {
    return this.currentHand;
  }

  cursorNext(): boolean {
    if (!this.cursor) return false;
    this.cursor.next();
    return !this.cursor.Iterator.EndReached;
  }

  cursorPrev(): void {
    if (!this.cursor) return;
    this.cursor.previous();
  }

  cursorReset(): void {
    if (!this.cursor) return;
    this.cursor.reset();
  }

  cursorShow(): void {
    this.cursor?.show();
  }

  cursorHide(): void {
    this.cursor?.hide();
  }

  getCursor(): Cursor | null {
    return this.cursor;
  }

  getOSMD(): OpenSheetMusicDisplay | null {
    return this.osmd;
  }

  getCursorTimestamp(): number {
    if (!this.cursor?.Iterator) return 0;
    return this.cursor.Iterator.currentTimeStamp.RealValue;
  }

  isCursorAtEnd(): boolean {
    return this.cursor?.Iterator?.EndReached ?? true;
  }

  getCurrentMeasureNumber(): number {
    if (!this.cursor?.Iterator?.CurrentMeasure) return 0;
    return this.cursor.Iterator.CurrentMeasureIndex + 1;
  }

  setCursorToMeasure(measureNumber: number): void {
    if (!this.cursor) return;
    this.cursor.reset();
    while (!this.cursor.Iterator.EndReached) {
      if (this.cursor.Iterator.CurrentMeasureIndex + 1 >= measureNumber) break;
      this.cursor.next();
    }
  }

  showWrongNote(x: number, y: number, wrongNoteName?: string): void {
    if (!this.wrongNoteOverlay) return;

    const marker = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    marker.setAttribute('class', 'wrong-note-marker');

    // Red X marker
    const size = 6;
    const line1 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line1.setAttribute('x1', String(x - size));
    line1.setAttribute('y1', String(y - size));
    line1.setAttribute('x2', String(x + size));
    line1.setAttribute('y2', String(y + size));
    line1.setAttribute('stroke', '#ef4444');
    line1.setAttribute('stroke-width', '2.5');
    line1.setAttribute('stroke-linecap', 'round');

    const line2 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line2.setAttribute('x1', String(x + size));
    line2.setAttribute('y1', String(y - size));
    line2.setAttribute('x2', String(x - size));
    line2.setAttribute('y2', String(y + size));
    line2.setAttribute('stroke', '#ef4444');
    line2.setAttribute('stroke-width', '2.5');
    line2.setAttribute('stroke-linecap', 'round');

    marker.appendChild(line1);
    marker.appendChild(line2);

    // Add note name label if provided
    if (wrongNoteName) {
      const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      label.setAttribute('x', String(x + size + 4));
      label.setAttribute('y', String(y + 4));
      label.setAttribute('fill', '#ef4444');
      label.setAttribute('font-size', '10');
      label.setAttribute('font-family', 'sans-serif');
      label.setAttribute('font-weight', 'bold');
      label.textContent = wrongNoteName;
      marker.appendChild(label);
    }

    this.wrongNoteOverlay.appendChild(marker);

    marker.style.opacity = '1';
    marker.style.transition = 'opacity 0.5s ease-out';
    const fadeId = setTimeout(() => {
      marker.style.opacity = '0';
      this.pendingTimers.delete(fadeId);
      const removeId = setTimeout(() => {
        marker.remove();
        this.pendingTimers.delete(removeId);
      }, 500);
      this.pendingTimers.add(removeId);
    }, 1000);
    this.pendingTimers.add(fadeId);
  }

  getCursorXPosition(): number {
    if (!this.cursor?.cursorElement) return 0;
    const rect = this.cursor.cursorElement.getBoundingClientRect();
    const containerRect = this.container.getBoundingClientRect();
    return rect.left - containerRect.left + this.container.scrollLeft + rect.width / 2;
  }

  getStaffYPosition(staff: 1 | 2, midiNote: number): number {
    const cursorEl = this.cursor?.cursorElement;
    if (!cursorEl) return 0;

    const cursorRect = cursorEl.getBoundingClientRect();
    const containerRect = this.container.getBoundingClientRect();
    const staffLineSpacing = 8;

    const refMidi = staff === 1 ? 71 : 50;
    const chromaticToDiatonic = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6];

    const refOctave = Math.floor(refMidi / 12);
    const refDiatonic = chromaticToDiatonic[refMidi % 12];
    const noteOctave = Math.floor(midiNote / 12);
    const noteDiatonic = chromaticToDiatonic[midiNote % 12];
    const stepsFromRef = (noteOctave - refOctave) * 7 + (noteDiatonic - refDiatonic);

    const cursorCenterY = cursorRect.top - containerRect.top + this.container.scrollTop + cursorRect.height * (staff === 1 ? 0.3 : 0.7);
    return cursorCenterY - stepsFromRef * (staffLineSpacing / 2);
  }

  getTotalMeasures(): number {
    return (this.osmd as any)?.sheet?.SourceMeasures?.length ?? 0;
  }

  destroy(): void {
    for (const id of this.pendingTimers) clearTimeout(id);
    this.pendingTimers.clear();
    this.clearNoteHighlights();
    this.wrongNoteOverlay?.remove();
    this.osmd?.clear();
    this.osmd = null;
    this.cursor = null;
  }
}
