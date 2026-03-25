import { OpenSheetMusicDisplay, Cursor } from 'opensheetmusicdisplay';
import type { IOSMDOptions } from 'opensheetmusicdisplay';
import type { HandSelection } from '../types';

export class ScoreRenderer {
  private osmd: OpenSheetMusicDisplay | null = null;
  private cursor: Cursor | null = null;
  private container: HTMLElement;
  private currentHand: HandSelection = 'both';
  private wrongNoteOverlay: SVGSVGElement | null = null;

  constructor(container: HTMLElement) {
    this.container = container;
  }

  async load(source: string | ArrayBuffer): Promise<void> {
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
    // Use CSS-based approach: add class to container to dim inactive staff
    this.container.classList.remove('hand-both', 'hand-left', 'hand-right');
    this.container.classList.add(`hand-${this.currentHand}`);
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
    setTimeout(() => {
      marker.style.opacity = '0';
      setTimeout(() => marker.remove(), 500);
    }, 1000);
  }

  getCursorXPosition(): number {
    if (!this.cursor?.cursorElement) return 0;
    const rect = this.cursor.cursorElement.getBoundingClientRect();
    const containerRect = this.container.getBoundingClientRect();
    return rect.left - containerRect.left + rect.width / 2;
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

    const cursorCenterY = cursorRect.top - containerRect.top + cursorRect.height * (staff === 1 ? 0.3 : 0.7);
    return cursorCenterY - stepsFromRef * (staffLineSpacing / 2);
  }

  getTotalMeasures(): number {
    return (this.osmd as any)?.sheet?.SourceMeasures?.length ?? 0;
  }

  destroy(): void {
    this.wrongNoteOverlay?.remove();
    this.osmd?.clear();
    this.osmd = null;
    this.cursor = null;
  }
}
