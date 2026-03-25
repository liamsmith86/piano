# Piano Practice App

## Overview
Single-page web app for learning piano from sheet music (MXL/MusicXML). Renders scores with OSMD, plays audio with Tone.js Salamander piano, supports MIDI keyboard input, and has a full practice mode with note-by-note progression.

## Tech Stack
- **Vite + TypeScript** — build/dev server, strict mode
- **OpenSheetMusicDisplay (OSMD)** — renders MusicXML as SVG
- **Tone.js** — Web Audio synthesis, Salamander Grand Piano samples
- **Web MIDI API** — hardware MIDI keyboard + sustain pedal
- **Tailwind CSS** — utility styling (imported via `@tailwindcss/vite`)
- **Vitest** — unit tests (jsdom environment)
- **Playwright** — E2E browser tests (Chromium)
- **Bun** — package manager (`bun` not `npm`)

## Commands
```bash
bun install              # Install dependencies
bun dev                  # Dev server on 0.0.0.0:5173 (LAN accessible)
bun run build            # Production build (tsc + vite build)
bun run test             # Unit tests (vitest)
bun run test:e2e         # E2E tests (playwright, auto-starts dev server)
bun x tsc --noEmit       # Type check only
bun x vitest run --coverage  # Coverage report
bun x playwright install # Install browser for E2E
```

## Project Structure
```
src/
  main.ts                 # Entry: wires UI, keyboard shortcuts, settings, events
  api.ts                  # PianoApp class: public API, exposed as window.pianoApp
  types.ts                # Shared types, MIDI/note utils, PRELOADED_SONGS list
  events.ts               # Typed EventEmitter
  storage.ts              # IndexedDB for uploaded songs
  progress.ts             # localStorage practice session history
  style.css               # All styles (Tailwind + custom CSS)
  score/
    ScoreRenderer.ts      # OSMD wrapper: load, render, cursor, note coloring
    ScoreAnalyzer.ts      # Extracts NoteEvent[] timeline from OSMD cursor
    ScoreInteraction.ts   # Click-to-jump, drag-to-select measure ranges
  audio/
    AudioEngine.ts        # Tone.js sampler, playback scheduling, metronome, count-in
  input/
    InputManager.ts       # Unified input event bus
    MidiInput.ts          # Web MIDI API + sustain pedal (CC 64)
    VirtualKeyboard.ts    # On-screen piano: auto-range, auto-scroll, highlights
    KeyboardInput.ts      # QWERTY → MIDI note mapping
  modes/
    PlayMode.ts           # Auto-playback with cursor sync, loop support
    PracticeMode.ts       # Wait-for-input, chords, loop, auto-advance, measure stats
  ui/
    Toolbar.ts            # Transport, mode toggle, hands, tempo, settings button
    SongLibrary.ts        # Song grid, search, upload, drag-drop, active indicator
    PracticeComplete.ts   # Grade overlay, stats, trouble spots, retry
    Settings.ts           # Toggle panel with skill presets (beginner/intermediate/advanced)
    NoteDisplay.ts        # Shows expected note name between score and keyboard
    CountIn.ts            # Visual beat countdown overlay
    ShortcutsHelp.ts      # Keyboard shortcuts modal (? key)
tests/
  unit/                   # 179 tests across 14 files
  e2e/                    # 115 tests across 11 files (includes full 18-song playthrough)
public/songs/             # 18 preloaded MXL files
```

## Key Architecture Decisions
- **MXL/MusicXML only** — no PDF (OMR unreliable), no MIDI-file-only rendering
- **Custom playback scheduler** — osmd-audio-player abandoned, osmd-extended requires sponsorship
- **Hand separation via CSS** — `.staffline[id$="-2"]` opacity for dimming
- **`window.pianoApp` API** — exposes full programmatic control for Playwright E2E tests
- **Note coloring** — SVG elements colored directly via `GNotesUnderCursor().getSVGGElement()`
- **Repeat handling** — cumulative beat offset with gap-bridging (not absolute)
- **Cursor index** — counts ALL cursor steps (including rests) for proper OSMD sync
- **Chord duplicate MIDI** — count-based hit tracking (Map not Set) for same-note chords
- **State reset on song load** — loop, selection, modes all cleared before loading new song
- **Audio init retry** — initPromise reset on failure so next user gesture can retry

## Important Patterns
- `ScoreAnalyzer.analyze()` iterates OSMD cursor to build `NoteEvent[]` timeline
- `NoteEvent.index` = absolute OSMD cursor step (includes rests), used for cursor sync
- `PracticeMode` uses count-based `hitCount` Map for chord tracking (handles duplicate MIDIs)
- `ScoreInteraction` maps OSMD measure bounding boxes to pixel coords for click/drag
- Both PlayMode and PracticeMode support `setLoop(start, end)` for measure range playback
- `markNotesPlayed()` colors SVG green and removes from `currentHighlight` to prevent revert
- `durationAtBeat()` computes note duration using tempo at the note's position (not beat 0)
- `syncCursorToIndex()` uses incremental advance O(delta) via `lastSyncedOsmdIndex`

## Commit Convention
Use semantic commit messages: `feat:`, `fix:`, `test:`, `style:`, `refactor:`, `docs:`, `chore:`

## Security Notes
- Song titles sanitized with escapeHtml() before innerHTML insertion
- No eval/Function constructors used anywhere
- All setTimeout IDs tracked and cleared on destroy to prevent memory leaks
- Audio init guarded against double-fire race condition
- OSMD is AGPL-3.0 — see LICENSE file for compliance notes

## Browser Support
- Chrome/Edge/Firefox: full support (Web MIDI + Web Audio)
- Safari: no MIDI keyboard (Web MIDI API unsupported), audio works
- iPad/iPhone: responsive layout, touch support, safe area insets

## Known Limitations
- OSMD `sheet` property is protected — accessed via `(osmd as any).sheet`
- Bundle is ~382KB gzipped (OSMD + Tone.js are large)
- Salamander samples require internet on first load (cached by browser)
- Metronome uses setInterval (drifts slightly over long sessions)

## Testing
- `bun run test` — 179 unit tests (93.6% statement coverage)
- `bun run test:e2e` — 115 E2E tests including full playthrough of all 18 songs
- Total: 294 tests, all passing
- Full playthrough test validates every note of every song with 0 wrong notes
