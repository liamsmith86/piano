import { OpenSheetMusicDisplay, Cursor } from 'opensheetmusicdisplay';
import type { IOSMDOptions } from 'opensheetmusicdisplay';
import type { HandSelection } from '../types';
import { ScoreOverlay } from './ScoreOverlay';

export class ScoreRenderer {
  private osmd: OpenSheetMusicDisplay | null = null;
  private cursor: Cursor | null = null;
  private container: HTMLElement;
  private currentHand: HandSelection = 'both';
  private wrongNoteOverlay: SVGGElement | null = null;
  private pendingTimers = new Set<ReturnType<typeof setTimeout>>();
  private overlay: ScoreOverlay;
  private _zoom: number = 1.5;

  constructor(container: HTMLElement) {
    this.container = container;
    this.overlay = new ScoreOverlay(container);
  }

  async load(source: string | ArrayBuffer): Promise<void> {
    // Clean up previous instance to prevent memory leaks
    this.clearNoteHighlights();
    this.overlay.clear();
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

    this.osmd.zoom = this._zoom;
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
    // Overlay <g> is now created on-demand in showWrongNoteAtCursor
    // to ensure it's in the correct SVG page for multi-page scores
    this.wrongNoteOverlay?.remove();
    this.wrongNoteOverlay = null;
  }

  applyHandColoring(): void {
    this.container.classList.remove('hand-both', 'hand-left', 'hand-right');
    this.container.classList.add(`hand-${this.currentHand}`);
  }

  // --- Note coloring for practice/play mode ---

  // Elements currently highlighted (blue) at the cursor — will be restored on next advance
  private currentHighlight: { el: SVGElement; origFill: string | null; origStroke: string | null }[] = [];
  // Elements marked as played (green) — stores original colors for restoration
  private playedElements = new Map<SVGElement, { origFill: string | null; origStroke: string | null }>();

  private colorSvgElements(svgEl: SVGGElement, color: string): SVGElement[] {
    const colored: SVGElement[] = [];
    svgEl.querySelectorAll('path, circle, ellipse').forEach((el: Element) => {
      const svgPath = el as SVGElement;
      const fill = svgPath.getAttribute('fill');
      const stroke = svgPath.getAttribute('stroke');
      if (fill && fill !== 'none') svgPath.setAttribute('fill', color);
      if (stroke && stroke !== 'none') svgPath.setAttribute('stroke', color);
      colored.push(svgPath);
    });
    return colored;
  }

  /** Color the noteheads at the current cursor position */
  highlightCurrentNotes(color: string): void {
    // Restore previous highlight to original (or green if played)
    for (const { el, origFill, origStroke } of this.currentHighlight) {
      if (this.playedElements.has(el)) {
        // This element was marked played — keep it green
        if (origFill !== null) el.setAttribute('fill', '#22c55e');
        if (origStroke !== null) el.setAttribute('stroke', '#22c55e');
      } else {
        // Restore original color
        if (origFill === null) el.removeAttribute('fill');
        else el.setAttribute('fill', origFill);
        if (origStroke === null) el.removeAttribute('stroke');
        else el.setAttribute('stroke', origStroke);
      }
    }
    this.currentHighlight = [];

    if (!this.cursor) return;
    const gnotes = (this.cursor as any).GNotesUnderCursor?.();
    if (!gnotes) return;

    for (const gn of gnotes) {
      try {
        const svgEl = gn.getSVGGElement?.() as SVGGElement | null;
        if (svgEl) {
          svgEl.querySelectorAll('path, circle, ellipse').forEach((el: Element) => {
            const svgPath = el as SVGElement;
            // If element is already played (green), use its true original, not current green
            const played = this.playedElements.get(svgPath);
            this.currentHighlight.push({
              el: svgPath,
              origFill: played ? played.origFill : svgPath.getAttribute('fill'),
              origStroke: played ? played.origStroke : svgPath.getAttribute('stroke'),
            });
          });
          this.colorSvgElements(svgEl, color);
        }
      } catch {}
    }
  }

  /** Mark notes at the current position as played (green) */
  markNotesPlayed(): void {
    if (!this.cursor) return;
    const gnotes = (this.cursor as any).GNotesUnderCursor?.();
    if (!gnotes) return;

    for (const gn of gnotes) {
      try {
        const svgEl = gn.getSVGGElement?.() as SVGGElement | null;
        if (svgEl) {
          svgEl.querySelectorAll('path, circle, ellipse').forEach((el: Element) => {
            const svgPath = el as SVGElement;
            if (!this.playedElements.has(svgPath)) {
              // If element is currently highlighted (blue), use the true original
              // stored in currentHighlight, not the current blue color
              const highlighted = this.currentHighlight.find(h => h.el === svgPath);
              this.playedElements.set(svgPath, {
                origFill: highlighted ? highlighted.origFill : svgPath.getAttribute('fill'),
                origStroke: highlighted ? highlighted.origStroke : svgPath.getAttribute('stroke'),
              });
            }
          });
          this.colorSvgElements(svgEl, '#22c55e');
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

  /** Reset green played notes back to original colors (for repeat sections) */
  resetPlayedNotes(): void {
    for (const [el, { origFill, origStroke }] of this.playedElements) {
      // If this element is currently blue-highlighted, don't change its visual —
      // just update currentHighlight's stored original so it restores correctly later
      const highlighted = this.currentHighlight.find(h => h.el === el);
      if (highlighted) {
        highlighted.origFill = origFill;
        highlighted.origStroke = origStroke;
      } else {
        if (origFill === null) el.removeAttribute('fill');
        else el.setAttribute('fill', origFill);
        if (origStroke === null) el.removeAttribute('stroke');
        else el.setAttribute('stroke', origStroke);
      }
    }
    this.playedElements.clear();
  }

  /** Clear all note coloring (restore originals, remove played markers and wrong notes) */
  clearNoteHighlights(): void {
    // Restore current blue highlight
    for (const { el, origFill, origStroke } of this.currentHighlight) {
      if (origFill === null) el.removeAttribute('fill');
      else el.setAttribute('fill', origFill);
      if (origStroke === null) el.removeAttribute('stroke');
      else el.setAttribute('stroke', origStroke);
    }
    this.currentHighlight = [];

    // Restore played (green) elements to their original colors
    for (const [el, { origFill, origStroke }] of this.playedElements) {
      if (origFill === null) el.removeAttribute('fill');
      else el.setAttribute('fill', origFill);
      if (origStroke === null) el.removeAttribute('stroke');
      else el.setAttribute('stroke', origStroke);
    }
    this.playedElements.clear();

    // Clear any lingering wrong note markers
    if (this.wrongNoteOverlay) {
      while (this.wrongNoteOverlay.firstChild) {
        this.wrongNoteOverlay.removeChild(this.wrongNoteOverlay.firstChild);
      }
    }
    for (const id of this.pendingTimers) clearTimeout(id);
    this.pendingTimers.clear();
  }

  setHand(hand: HandSelection): void {
    this.currentHand = hand;
    this.applyHandColoring();
  }

  getHand(): HandSelection {
    return this.currentHand;
  }

  setZoom(zoom: number): void {
    this._zoom = Math.max(0.5, Math.min(3.0, zoom));
    if (this.osmd) {
      this.osmd.zoom = this._zoom;
      this.osmd.render();
      this.setupCursor();
      this.applyHandColoring();
    }
  }

  getZoom(): number {
    return this._zoom;
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

  private currentWrongMarker: SVGGElement | null = null;
  private wrongMarkerTimerId: ReturnType<typeof setTimeout> | null = null;

  /**
   * Show wrong note marker at the position of the closest expected note under the cursor.
   * Uses actual graphical note positions from OSMD rather than hardcoded math.
   */
  // Chromatic MIDI pitch → diatonic step (C=0, D=1, E=2, F=3, G=4, A=5, B=6)
  private static readonly CHROMATIC_TO_DIATONIC = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6];

  private midiToDiatonic(midi: number): number {
    const octave = Math.floor(midi / 12);
    return octave * 7 + ScoreRenderer.CHROMATIC_TO_DIATONIC[midi % 12];
  }

  showWrongNoteAtCursor(wrongMidi: number, wrongNoteName?: string): void {
    if (!this.cursor) return;

    const gnotes = (this.cursor as any).GNotesUnderCursor?.();
    if (!gnotes || gnotes.length === 0) return;

    // Find the closest graphical note by MIDI distance
    let closestGN: any = null;
    let closestDist = Infinity;
    let closestMidi = 0;

    for (const gn of gnotes) {
      try {
        const halfTone = gn.sourceNote?.halfTone;
        if (halfTone == null || gn.sourceNote?.isRest?.()) continue;
        const midi = halfTone + 12;
        const dist = Math.abs(midi - wrongMidi);
        if (dist < closestDist) {
          closestDist = dist;
          closestGN = gn;
          closestMidi = midi;
        }
      } catch {}
    }

    // Fallback to first non-rest note
    if (!closestGN) {
      for (const gn of gnotes) {
        if (!gn.sourceNote?.isRest?.()) { closestGN = gn; break; }
      }
    }
    if (!closestGN) return;

    // Get position from the notehead SVG in OSMD's coordinate space
    let nhBox: { x: number; y: number; width: number; height: number } | null = null;
    let noteSvgEl: SVGElement | null = null;
    try {
      const noteheadSvgs = closestGN.getNoteheadSVGs?.();
      if (noteheadSvgs?.length > 0) {
        noteSvgEl = noteheadSvgs[0];
        const b = (noteSvgEl as any).getBBox?.();
        if (b && b.width > 0) nhBox = b;
      }
      if (!nhBox) {
        noteSvgEl = closestGN.getSVGGElement?.() ?? null;
        if (noteSvgEl) {
          const b = (noteSvgEl as any).getBBox?.();
          if (b && b.width > 0) nhBox = b;
        }
      }
    } catch {}
    if (!nhBox || !noteSvgEl) return;

    // Ensure overlay <g> is in the same SVG page as the target note
    const parentSvg = noteSvgEl.closest('svg');
    if (!parentSvg) return;

    if (!this.wrongNoteOverlay || this.wrongNoteOverlay.closest('svg') !== parentSvg) {
      this.wrongNoteOverlay?.remove();
      const overlay = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      overlay.setAttribute('class', 'wrong-note-overlay');
      overlay.style.pointerEvents = 'none';
      parentSvg.appendChild(overlay);
      this.wrongNoteOverlay = overlay;
    }

    // Calculate vertical offset: each diatonic step = half a staff line spacing.
    // In OSMD SVG, staff line spacing ≈ 10 units and nhBox.height ≈ 10 units (notehead
    // height matches the staff line spacing). Each diatonic step = nhBox.height / 2.
    // Higher notes = lower Y in SVG, so offset is negative for higher wrong notes.
    const diatonicDiff = this.midiToDiatonic(wrongMidi) - this.midiToDiatonic(closestMidi);
    const stepHeight = nhBox.height / 2;
    const yOffset = -diatonicDiff * stepHeight;

    const x = nhBox.x + nhBox.width / 2;
    const y = nhBox.y + nhBox.height / 2 + yOffset;

    this.showWrongNote(x, y, wrongNoteName);
  }

  showWrongNote(x: number, y: number, wrongNoteName?: string): void {
    if (!this.wrongNoteOverlay) return;

    // Remove previous wrong note marker instantly (only one at a time)
    if (this.currentWrongMarker) {
      this.currentWrongMarker.remove();
      this.currentWrongMarker = null;
    }
    if (this.wrongMarkerTimerId !== null) {
      clearTimeout(this.wrongMarkerTimerId);
      this.pendingTimers.delete(this.wrongMarkerTimerId);
      this.wrongMarkerTimerId = null;
    }

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
    this.currentWrongMarker = marker;

    // Quick fade: show for 400ms, then fade out over 200ms
    marker.style.opacity = '1';
    marker.style.transition = 'opacity 0.2s ease-out';
    const fadeId = setTimeout(() => {
      marker.style.opacity = '0';
      this.pendingTimers.delete(fadeId);
      const removeId = setTimeout(() => {
        if (this.currentWrongMarker === marker) {
          this.currentWrongMarker = null;
        }
        marker.remove();
        this.pendingTimers.delete(removeId);
      }, 200);
      this.pendingTimers.add(removeId);
    }, 400);
    this.pendingTimers.add(fadeId);
    this.wrongMarkerTimerId = fadeId;
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

  getOverlay(): ScoreOverlay {
    return this.overlay;
  }

  destroy(): void {
    for (const id of this.pendingTimers) clearTimeout(id);
    this.pendingTimers.clear();
    this.clearNoteHighlights();
    this.overlay.destroy();
    this.wrongNoteOverlay?.remove();
    this.osmd?.clear();
    this.osmd = null;
    this.cursor = null;
  }
}
