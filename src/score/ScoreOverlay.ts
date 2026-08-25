import type { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';
import type { NoteEvent } from '../types';
import {
  buildPracticeStaffMap,
  getPracticeHand,
  getSourceNoteId,
  type PracticeStaffMap,
} from './PracticePart';
import { detectChord } from './ChordAnalyzer';

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
const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

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
  private showChords = false;
  private updateCount = 0;

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
    this.updateCount++;
    this.clear();

    if (!this.showNoteNames && !this.showAccidentals && !this.showFingering && !this.showChords) return;

    const graphic = (osmd as any).graphic;
    if (!graphic?.measureList) return;

    // Find ALL OSMD SVG pages (OSMD creates one SVG per page for multi-page scores)
    const allSvgs = this.container.querySelectorAll('svg[id^="osmdSvgPage"]');
    if (allSvgs.length === 0) return;
    const practiceStaffHands = buildPracticeStaffMap(osmd);

    // Create one overlay group per SVG page — we'll add notes to the right page's group
    const svgGroups = new Map<SVGSVGElement, SVGGElement>();
    for (const svg of allSvgs) {
      const group = document.createElementNS(SVG_NAMESPACE, 'g');
      group.setAttribute('class', 'score-overlay');
      group.setAttribute('aria-hidden', 'true');
      group.setAttribute('focusable', 'false');
      group.style.pointerEvents = 'none';
      svgGroups.set(svg as SVGSVGElement, group);
    }

    // Match fingering to the exact OSMD source note. A MIDI/staff/measure key is
    // ambiguous whenever a pitch repeats within a measure.
    const fingerLookup = new Map<number, number>();
    if (this.showFingering && timeline) {
      for (const event of timeline) {
        for (const note of event.notes) {
          if (note.finger) {
            if (note.sourceNoteId !== undefined && !fingerLookup.has(note.sourceNoteId)) {
              fingerLookup.set(note.sourceNoteId, note.finger);
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
                this.renderNoteOverlays(
                  gNote, noteGroup, fingerLookup, keyMap, measureIdx, practiceStaffHands,
                );
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
    fingerLookup: Map<number, number>,
    keyMap: Map<number, any> | null,
    measureIdx: number,
    practiceStaffHands: PracticeStaffMap,
  ): void {
    const sourceNote = gNote.sourceNote;
    if (!sourceNote || sourceNote.isRest?.()) return;
    const staff = getPracticeHand(sourceNote, practiceStaffHands);
    if (!staff) return;

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
    const nhH = nhBox.height;
    const nhW = nhBox.width;
    const pitchAccidental = pitch.Accidental !== ACC_NONE && pitch.Accidental !== ACC_NATURAL
      ? accidentalSymbol(pitch.Accidental)
      : '';

    // Note names sit toward the grand-staff centre while fingering sits on the
    // outside. A restrained paper-coloured halo keeps both readable without
    // covering staff lines or turning every note into a coloured badge.
    if (this.showNoteNames) {
      const fundamental = pitch.FundamentalNote;
      const letter = NOTE_ENUM_NAMES[fundamental] ?? '?';
      const label = letter + pitchAccidental;
      const yPos = staff === 1 ? nhBox.y + nhH + 5.5 : nhBox.y - 5.5;
      this.appendText(group, {
        text: label,
        x: cx,
        y: yPos,
        className: 'note-name-label learner-annotation',
        staff,
      });
    }

    // Courtesy accidentals follow engraving convention: a quiet parenthesised
    // musical glyph to the left, rather than a coloured hashtag-style badge.
    if (this.showAccidentals && keyMap && (!this.showNoteNames || !pitchAccidental)) {
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
            this.appendText(group, {
              text: `(${accSymbol})`,
              x: nhBox.x - Math.max(2.5, nhW * 0.25),
              y: cy,
              className: 'courtesy-accidental learner-annotation',
              staff,
              anchor: 'end',
            });
          }
        }
      }
    }

    // Conventional, unboxed fingering numbers stay close to the notehead and
    // outside the grand staff. The text halo supplies contrast over slurs and
    // ledger lines without the visual weight of a circle around every number.
    if (this.showFingering) {
      const finger = fingerLookup.get(getSourceNoteId(sourceNote));

      if (finger) {
        const yPos = staff === 1 ? nhBox.y - 6.5 : nhBox.y + nhH + 6.5;
        this.appendText(group, {
          text: String(finger),
          x: cx,
          y: yPos,
          className: 'fingering-label learner-annotation',
          staff,
        });
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
    const rendered = new Set<string>();
    let lastRenderedChord: string | null = null;

    for (const event of timeline) {
      const allMidis = event.notes.map(n => n.midi);
      const chord = detectChord(allMidis);
      if (!chord) continue;
      if (chord === lastRenderedChord) continue;

      const sourceNoteIds = event.notes
        .map(note => note.sourceNoteId)
        .filter((id): id is number => id !== undefined)
        .sort((a, b) => a - b);
      const key = sourceNoteIds.length > 0
        ? sourceNoteIds.join(':')
        : `${event.measureNumber}:${event.index}`;
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
              const matchesEvent = sourceNoteIds.length > 0
                ? sourceNoteIds.includes(getSourceNoteId(src))
                : allMidis.includes((src.Pitch?.getHalfTone?.() ?? src.Pitch?.halfTone ?? 0) + 12);
              if (matchesEvent) {
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
      const yPos = staffY - 8; // Above the top staff line

      this.appendText(noteGroup, {
        text: chord,
        x: cx,
        y: yPos,
        className: 'chord-symbol learner-annotation',
      });
      lastRenderedChord = chord;
    }
  }

  private appendText(
    group: SVGGElement,
    options: {
      text: string;
      x: number;
      y: number;
      className: string;
      staff?: 1 | 2;
      anchor?: 'start' | 'middle' | 'end';
    },
  ): SVGTextElement {
    const text = document.createElementNS(SVG_NAMESPACE, 'text');
    text.setAttribute('x', String(options.x));
    text.setAttribute('y', String(options.y));
    text.setAttribute('text-anchor', options.anchor ?? 'middle');
    text.setAttribute('dominant-baseline', 'central');
    text.setAttribute('class', options.className);
    if (options.staff) text.setAttribute('data-staff', String(options.staff));
    text.textContent = options.text;
    group.appendChild(text);
    return text;
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

  getUpdateCount(): number {
    return this.updateCount;
  }

  destroy(): void {
    this.clear();
  }
}
