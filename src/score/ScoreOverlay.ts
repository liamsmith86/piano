import type { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';
import type { NoteEvent } from '../types';

// Map OSMD NoteEnum values to letter names
const NOTE_ENUM_NAMES: Record<number, string> = {
  0: 'C', 2: 'D', 4: 'E', 5: 'F', 7: 'G', 9: 'A', 11: 'B',
};

// AccidentalEnum values from OSMD
const ACC_SHARP = 0;
const ACC_FLAT = 1;
const ACC_NONE = 2;
const ACC_NATURAL = 3;
const ACC_DOUBLE_SHARP = 4;
const ACC_DOUBLE_FLAT = 5;

function accidentalSymbol(acc: number): string {
  switch (acc) {
    case ACC_SHARP: return '♯';
    case ACC_FLAT: return '♭';
    case ACC_DOUBLE_SHARP: return '𝄪';
    case ACC_DOUBLE_FLAT: return '𝄫';
    case ACC_NATURAL: return '♮';
    default: return '';
  }
}

export class ScoreOverlay {
  private container: HTMLElement;
  private overlayGroup: SVGGElement | null = null;

  private showNoteNames = false;
  private showAccidentals = false;
  private showFingering = false;

  constructor(container: HTMLElement) {
    this.container = container;
  }

  setShowNoteNames(enabled: boolean): void {
    this.showNoteNames = enabled;
  }

  setShowAccidentals(enabled: boolean): void {
    this.showAccidentals = enabled;
  }

  setShowFingering(enabled: boolean): void {
    this.showFingering = enabled;
  }

  /**
   * Render overlays on the score by injecting a <g> directly into OSMD's SVG.
   * This ensures getBBox() coordinates are in the same space as our text elements.
   */
  update(osmd: OpenSheetMusicDisplay, timeline?: NoteEvent[]): void {
    this.clear();

    if (!this.showNoteNames && !this.showAccidentals && !this.showFingering) return;

    const graphic = (osmd as any).graphic;
    if (!graphic?.measureList) return;

    // Find ALL OSMD SVG pages (OSMD creates one SVG per page for multi-page scores)
    const allSvgs = this.container.querySelectorAll('svg[id^="osmdSvgPage"]');
    if (allSvgs.length === 0) return;

    // Create one overlay group per SVG page — we'll add notes to the right page's group
    const svgGroups = new Map<SVGSVGElement, SVGGElement>();
    for (const svg of allSvgs) {
      const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      group.setAttribute('class', 'score-overlay');
      group.style.pointerEvents = 'none';
      svgGroups.set(svg as SVGSVGElement, group);
    }

    // Build a lookup from (midi, staff) → finger for fingering display
    const fingerLookup = new Map<string, number>();
    if (this.showFingering && timeline) {
      for (const event of timeline) {
        for (const note of event.notes) {
          if (note.finger) {
            fingerLookup.set(`${note.midi}:${note.staff}`, note.finger);
          }
        }
      }
    }

    // Get active key instructions per measure for courtesy accidentals
    const keyMap = this.showAccidentals ? this.buildKeyMap(osmd) : null;

    // Iterate over all graphical notes
    for (const measureRow of graphic.measureList) {
      for (const gMeasure of measureRow) {
        if (!gMeasure?.staffEntries) continue;

        const measureIdx = (gMeasure as any).MeasureNumber ?? 0;

        for (const staffEntry of gMeasure.staffEntries) {
          if (!staffEntry?.graphicalVoiceEntries) continue;

          for (const voiceEntry of staffEntry.graphicalVoiceEntries) {
            if (!voiceEntry?.notes) continue;

            for (const gNote of voiceEntry.notes) {
              // Find which SVG page this note belongs to
              let noteGroup: SVGGElement | null = null;
              try {
                const svgEl = gNote.getSVGGElement?.();
                if (svgEl) {
                  const parentSvg = svgEl.closest('svg') as SVGSVGElement | null;
                  if (parentSvg) noteGroup = svgGroups.get(parentSvg) ?? null;
                }
              } catch { /* continue */ }
              if (!noteGroup) noteGroup = svgGroups.values().next().value ?? null;
              if (noteGroup) {
                this.renderNoteOverlays(gNote, noteGroup, fingerLookup, keyMap, measureIdx);
              }
            }
          }
        }
      }
    }

    // Append each group to its SVG page (only if it has content)
    for (const [svg, group] of svgGroups) {
      if (group.children.length > 0) {
        svg.appendChild(group);
      }
    }
    // Store first group for backwards compat with clear()
    this.overlayGroup = svgGroups.values().next().value ?? null;
  }

  private renderNoteOverlays(
    gNote: any,
    group: SVGGElement,
    fingerLookup: Map<string, number>,
    keyMap: Map<number, any> | null,
    measureIdx: number,
  ): void {
    const sourceNote = gNote.sourceNote;
    if (!sourceNote || sourceNote.isRest?.()) return;

    const pitch = sourceNote.Pitch;
    if (!pitch) return;

    // Get notehead bounding box — these coordinates are in OSMD's SVG space
    let nhBox: { x: number; y: number; width: number; height: number } | null = null;
    try {
      const noteheadSvgs = gNote.getNoteheadSVGs?.();
      if (noteheadSvgs?.length > 0) {
        const b = noteheadSvgs[0].getBBox?.();
        if (b && b.width > 0) nhBox = b;
      }
      if (!nhBox) {
        const svgEl = gNote.getSVGGElement?.();
        if (svgEl) {
          const b = svgEl.getBBox?.();
          if (b && b.width > 0) nhBox = b;
        }
      }
    } catch {
      return;
    }
    if (!nhBox) return;

    const cx = nhBox.x + nhBox.width / 2;
    const cy = nhBox.y + nhBox.height / 2;
    const staffId = sourceNote.ParentStaffEntry?.ParentStaff?.idInMusicSheet ?? 0;
    const staff = staffId === 0 ? 1 : 2;

    const nhH = nhBox.height;
    const nhW = nhBox.width;

    // Feature 1: Note letter names — with background pill for readability
    if (this.showNoteNames) {
      const fundamental = pitch.FundamentalNote;
      const letter = NOTE_ENUM_NAMES[fundamental] ?? '?';
      const acc = pitch.Accidental;
      const accStr = (acc !== ACC_NONE && acc !== ACC_NATURAL) ? accidentalSymbol(acc) : '';
      const label = letter + accStr;

      const fontSize = 10;
      // Position: below notehead for both staves
      // Fingering goes above, note names go below — no collision
      const yPos = nhBox.y + nhH + fontSize + 2;

      // Background pill for contrast against staff lines
      const pillW = label.length > 1 ? fontSize * 1.3 : fontSize * 0.85;
      const pillH = fontSize * 0.95;
      const pill = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      pill.setAttribute('x', String(cx - pillW / 2));
      pill.setAttribute('y', String(yPos - pillH + 1));
      pill.setAttribute('width', String(pillW));
      pill.setAttribute('height', String(pillH));
      pill.setAttribute('rx', '2');
      pill.setAttribute('fill', '#dbeafe');
      pill.setAttribute('opacity', '0.85');
      pill.setAttribute('class', 'note-name-bg');
      pill.setAttribute('data-staff', String(staff));
      group.appendChild(pill);

      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('x', String(cx));
      text.setAttribute('y', String(yPos - pillH / 2 + 1));
      text.setAttribute('text-anchor', 'middle');
      text.setAttribute('dominant-baseline', 'central');
      text.setAttribute('font-size', String(fontSize));
      text.setAttribute('font-weight', '700');
      text.setAttribute('font-family', 'Arial, Helvetica, sans-serif');
      text.setAttribute('fill', '#1d4ed8');
      text.setAttribute('class', 'note-name-label');
      text.setAttribute('data-staff', String(staff));
      text.textContent = label;
      group.appendChild(text);
    }

    // Feature 2: Courtesy accidentals — to the left of the notehead with background
    if (this.showAccidentals && keyMap) {
      const drawnAcc = gNote.DrawnAccidental ?? ACC_NONE;

      if (drawnAcc === ACC_NONE || drawnAcc === undefined) {
        const keyInstr = this.getActiveKey(keyMap, measureIdx);
        if (keyInstr) {
          let shouldShow = false;
          let accSymbol = '';

          try {
            if (keyInstr.willAlterateNote?.(pitch.FundamentalNote)) {
              shouldShow = true;
              const alteration = keyInstr.getAlterationForPitch?.(pitch);
              if (alteration !== undefined && alteration !== ACC_NONE && alteration !== ACC_NATURAL) {
                accSymbol = accidentalSymbol(alteration);
              }
            }
          } catch {
            shouldShow = false;
          }

          if (!shouldShow && keyInstr.Key !== undefined && keyInstr.Key !== 0) {
            const keyNum = keyInstr.Key as number;
            const sharps = [5, 0, 7, 2, 9, 4, 11];
            const flats = [11, 4, 9, 2, 7, 0, 5];

            if (keyNum > 0) {
              const alteredNotes = sharps.slice(0, keyNum);
              if (alteredNotes.includes(pitch.FundamentalNote)) {
                shouldShow = true;
                accSymbol = '♯';
              }
            } else if (keyNum < 0) {
              const alteredNotes = flats.slice(0, Math.abs(keyNum));
              if (alteredNotes.includes(pitch.FundamentalNote)) {
                shouldShow = true;
                accSymbol = '♭';
              }
            }
          }

          if (shouldShow && accSymbol) {
            const accFontSize = 13;
            const accX = nhBox.x - nhW * 0.3;
            const accY = cy;

            // Small background for contrast
            const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            bg.setAttribute('x', String(accX - accFontSize * 0.9));
            bg.setAttribute('y', String(accY - accFontSize * 0.45));
            bg.setAttribute('width', String(accFontSize * 0.85));
            bg.setAttribute('height', String(accFontSize * 0.85));
            bg.setAttribute('rx', '1.5');
            bg.setAttribute('fill', '#f3e8ff');
            bg.setAttribute('opacity', '0.85');
            bg.setAttribute('class', 'courtesy-accidental-bg');
            bg.setAttribute('data-staff', String(staff));
            group.appendChild(bg);

            const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            text.setAttribute('x', String(accX - accFontSize * 0.45));
            text.setAttribute('y', String(accY));
            text.setAttribute('text-anchor', 'middle');
            text.setAttribute('dominant-baseline', 'central');
            text.setAttribute('font-size', String(accFontSize));
            text.setAttribute('font-family', 'serif');
            text.setAttribute('fill', '#7e22ce');
            text.setAttribute('class', 'courtesy-accidental');
            text.setAttribute('data-staff', String(staff));
            text.textContent = accSymbol;
            group.appendChild(text);
          }
        }
      }
    }

    // Feature 3: Fingering numbers — above noteheads (both staves), with circled style
    if (this.showFingering) {
      const midiNumber = (pitch.getHalfTone?.() ?? pitch.halfTone ?? 0) + 12;
      const key = `${midiNumber}:${staff}`;
      const finger = fingerLookup.get(key);

      if (finger) {
        const fontSize = 9;
        const radius = fontSize * 0.6;
        // Place above noteheads for treble, below for bass
        const yPos = staff === 1 ? nhBox.y - 10 : nhBox.y + nhH + 12;

        // Circular background
        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttribute('cx', String(cx));
        circle.setAttribute('cy', String(yPos));
        circle.setAttribute('r', String(radius));
        circle.setAttribute('fill', '#f0fdf4');
        circle.setAttribute('stroke', '#16a34a');
        circle.setAttribute('stroke-width', '0.8');
        circle.setAttribute('class', 'fingering-bg');
        circle.setAttribute('data-staff', String(staff));
        group.appendChild(circle);

        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttribute('x', String(cx));
        text.setAttribute('y', String(yPos));
        text.setAttribute('text-anchor', 'middle');
        text.setAttribute('dominant-baseline', 'central');
        text.setAttribute('font-size', String(fontSize));
        text.setAttribute('font-weight', '700');
        text.setAttribute('font-family', 'Arial, Helvetica, sans-serif');
        text.setAttribute('fill', '#15803d');
        text.setAttribute('class', 'fingering-label');
        text.setAttribute('data-staff', String(staff));
        text.textContent = String(finger);
        group.appendChild(text);
      }
    }
  }

  private buildKeyMap(osmd: OpenSheetMusicDisplay): Map<number, any> {
    const map = new Map<number, any>();
    const sheet = (osmd as any).sheet;
    if (!sheet?.SourceMeasures) return map;

    let activeKey: any = null;
    for (let i = 0; i < sheet.SourceMeasures.length; i++) {
      const sm = sheet.SourceMeasures[i];
      try {
        const firstStaffEntry = sm.FirstInstructionsStaffEntries?.[0];
        if (firstStaffEntry?.Instructions) {
          for (const instr of firstStaffEntry.Instructions) {
            if (instr.Key !== undefined) {
              activeKey = instr;
            }
          }
        }
      } catch {
        // Not all measures have key instructions
      }
      if (activeKey) {
        map.set(i, activeKey);
      }
    }

    let lastKey: any = null;
    for (let i = 0; i < sheet.SourceMeasures.length; i++) {
      if (map.has(i)) {
        lastKey = map.get(i);
      } else if (lastKey) {
        map.set(i, lastKey);
      }
    }

    return map;
  }

  private getActiveKey(keyMap: Map<number, any>, measureIdx: number): any {
    return keyMap.get(measureIdx - 1) ?? keyMap.get(measureIdx) ?? keyMap.get(0);
  }

  clear(): void {
    // Remove stored reference
    this.overlayGroup?.remove();
    this.overlayGroup = null;
    // Also remove any stale overlay groups left in the container
    // (can happen when OSMD recreates its SVG on song switch)
    this.container.querySelectorAll('g.score-overlay').forEach(g => g.remove());
  }

  destroy(): void {
    this.clear();
  }
}
