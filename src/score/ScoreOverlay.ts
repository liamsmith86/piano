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

// Chord detection from pitch classes
const CHORD_TYPES: [number[], string][] = [
  // Triads
  [[0, 4, 7], 'maj'],
  [[0, 3, 7], 'm'],
  [[0, 3, 6], 'dim'],
  [[0, 4, 8], 'aug'],
  [[0, 5, 7], 'sus4'],
  [[0, 2, 7], 'sus2'],
  // Sevenths
  [[0, 4, 7, 11], 'maj7'],
  [[0, 4, 7, 10], '7'],
  [[0, 3, 7, 10], 'm7'],
  [[0, 3, 6, 10], 'm7♭5'],
  [[0, 3, 6, 9], 'dim7'],
  [[0, 4, 8, 10], 'aug7'],
  // Sixths
  [[0, 4, 7, 9], '6'],
  [[0, 3, 7, 9], 'm6'],
];

const ROOT_NAMES = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'];

function detectChord(midiNotes: number[]): string | null {
  if (midiNotes.length < 3) return null;

  // Get unique pitch classes sorted
  const pitchClasses = [...new Set(midiNotes.map(m => m % 12))].sort((a, b) => a - b);
  if (pitchClasses.length < 3) return null;

  // Try each pitch class as root (to handle inversions)
  for (const root of pitchClasses) {
    const intervals = pitchClasses.map(pc => (pc - root + 12) % 12).sort((a, b) => a - b);

    for (const [pattern, name] of CHORD_TYPES) {
      if (pattern.length !== intervals.length) continue;
      if (pattern.every((v, i) => v === intervals[i])) {
        const suffix = name === 'maj' ? '' : name;
        return ROOT_NAMES[root] + suffix;
      }
    }
  }

  // Try matching just the triad (ignore extra notes)
  if (pitchClasses.length > 3) {
    for (const root of pitchClasses) {
      const intervals = pitchClasses.map(pc => (pc - root + 12) % 12).sort((a, b) => a - b);
      for (const [pattern, name] of CHORD_TYPES) {
        if (pattern.length > intervals.length) continue;
        if (pattern.every(v => intervals.includes(v))) {
          const suffix = name === 'maj' ? '' : name;
          return ROOT_NAMES[root] + suffix;
        }
      }
    }
  }

  return null;
}

export class ScoreOverlay {
  private container: HTMLElement;
  private overlayGroup: SVGGElement | null = null;

  private showNoteNames = false;
  private showAccidentals = false;
  private showFingering = false;
  private showChords = false;

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

  setShowChords(enabled: boolean): void {
    this.showChords = enabled;
  }

  /**
   * Render overlays on the score by injecting a <g> directly into OSMD's SVG.
   * This ensures getBBox() coordinates are in the same space as our text elements.
   */
  update(osmd: OpenSheetMusicDisplay, timeline?: NoteEvent[]): void {
    this.clear();

    if (!this.showNoteNames && !this.showAccidentals && !this.showFingering && !this.showChords) return;

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

    // Build a lookup from (midi, staff, measure) → finger for fingering display
    // Use first occurrence only (standard convention for repeated sections)
    const fingerLookup = new Map<string, number>();
    if (this.showFingering && timeline) {
      for (const event of timeline) {
        for (const note of event.notes) {
          if (note.finger) {
            const key = `${note.midi}:${note.staff}:${event.measureNumber}`;
            if (!fingerLookup.has(key)) {
              fingerLookup.set(key, note.finger);
            }
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

    // Feature 4: Chord symbols above the staff at each beat position
    if (this.showChords && timeline) {
      this.renderChordSymbols(graphic, timeline, svgGroups);
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
      const key = `${midiNumber}:${staff}:${measureIdx}`;
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

  private renderChordSymbols(
    graphic: any,
    timeline: NoteEvent[],
    svgGroups: Map<SVGSVGElement, SVGGElement>,
  ): void {
    // Group timeline events by measure and collect all MIDI notes per beat position
    // We only render a chord symbol at positions where there are 3+ unique pitch classes
    const rendered = new Set<string>(); // "measure:beat" dedup key

    for (const event of timeline) {
      const allMidis = event.notes.map(n => n.midi);
      const chord = detectChord(allMidis);
      if (!chord) continue;

      const key = `${event.measureNumber}:${event.index}`;
      if (rendered.has(key)) continue;
      rendered.add(key);

      // Find the graphical measure to get position
      const measureRow = graphic.measureList[event.measureNumber - 1];
      if (!measureRow?.[0]) continue;
      const gMeasure = measureRow[0]; // top staff measure

      // Find the staff entry closest to this event's cursor index
      let targetEntry: any = null;
      if (gMeasure.staffEntries) {
        for (const entry of gMeasure.staffEntries) {
          if (!entry?.graphicalVoiceEntries) continue;
          for (const ve of entry.graphicalVoiceEntries) {
            if (!ve?.notes) continue;
            for (const gNote of ve.notes) {
              const src = gNote.sourceNote;
              if (!src || src.isRest?.()) continue;
              const midi = ((src.Pitch?.getHalfTone?.() ?? src.Pitch?.halfTone ?? 0) + 12);
              if (allMidis.includes(midi)) {
                targetEntry = entry;
                break;
              }
            }
            if (targetEntry) break;
          }
          if (targetEntry) break;
        }
      }

      if (!targetEntry) continue;

      // Get X position from the staff entry and Y position above the top staff
      let entryBox: { x: number; y: number; width: number; height: number } | null = null;
      try {
        // Try getting position from the first note in the entry
        for (const ve of targetEntry.graphicalVoiceEntries) {
          for (const gNote of ve.notes) {
            const svgEl = gNote.getSVGGElement?.();
            if (svgEl) {
              const b = svgEl.getBBox?.();
              if (b && b.width > 0) { entryBox = b; break; }
            }
          }
          if (entryBox) break;
        }
      } catch { /* continue */ }

      if (!entryBox) continue;

      // Find which SVG page this belongs to
      let noteGroup: SVGGElement | null = null;
      try {
        for (const ve of targetEntry.graphicalVoiceEntries) {
          for (const gNote of ve.notes) {
            const svgEl = gNote.getSVGGElement?.();
            if (svgEl) {
              const parentSvg = svgEl.closest('svg') as SVGSVGElement | null;
              if (parentSvg) { noteGroup = svgGroups.get(parentSvg) ?? null; break; }
            }
          }
          if (noteGroup) break;
        }
      } catch { /* continue */ }
      if (!noteGroup) noteGroup = svgGroups.values().next().value ?? null;
      if (!noteGroup) continue;

      // Get the bounding box of the top staff line to position above it
      const staffY = this.getTopStaffY(gMeasure) ?? (entryBox.y - 30);

      const cx = entryBox.x + entryBox.width / 2;
      const fontSize = 11;
      const yPos = staffY - 8; // Above the top staff line

      // Background pill
      const pillW = chord.length * fontSize * 0.55 + 6;
      const pillH = fontSize + 2;
      const pill = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      pill.setAttribute('x', String(cx - pillW / 2));
      pill.setAttribute('y', String(yPos - pillH / 2));
      pill.setAttribute('width', String(pillW));
      pill.setAttribute('height', String(pillH));
      pill.setAttribute('rx', '2');
      pill.setAttribute('fill', '#fef3c7');
      pill.setAttribute('opacity', '0.9');
      pill.setAttribute('class', 'chord-symbol-bg');
      noteGroup.appendChild(pill);

      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('x', String(cx));
      text.setAttribute('y', String(yPos));
      text.setAttribute('text-anchor', 'middle');
      text.setAttribute('dominant-baseline', 'central');
      text.setAttribute('font-size', String(fontSize));
      text.setAttribute('font-weight', '700');
      text.setAttribute('font-family', 'Arial, Helvetica, sans-serif');
      text.setAttribute('fill', '#92400e');
      text.setAttribute('class', 'chord-symbol');
      text.textContent = chord;
      noteGroup.appendChild(text);
    }
  }

  private getTopStaffY(gMeasure: any): number | null {
    try {
      // Try to get bounding box of the first staff entry in the measure
      if (gMeasure.staffEntries?.length > 0) {
        const entry = gMeasure.staffEntries[0];
        for (const ve of entry.graphicalVoiceEntries) {
          for (const gNote of ve.notes) {
            const svgEl = gNote.getSVGGElement?.();
            if (svgEl) {
              const b = svgEl.getBBox?.();
              // Return Y position of the top of the staff (above notes)
              if (b && b.height > 0) return b.y - 20;
            }
          }
        }
      }
    } catch { /* continue */ }
    return null;
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
