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
bun dev                  # Dev server on localhost:5173
bun run build            # Production build (tsc + vite build)
bun run test             # Unit tests (vitest)
bun run test:e2e         # E2E tests (playwright, auto-starts dev server)
bun x tsc --noEmit       # Type check only
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
    ScoreRenderer.ts      # OSMD wrapper: load, render, cursor, wrong note markers
    ScoreAnalyzer.ts      # Extracts NoteEvent[] timeline from OSMD cursor
  audio/
    AudioEngine.ts        # Tone.js sampler, playback scheduling, metronome, count-in
  input/
    InputManager.ts       # Unified input event bus
    MidiInput.ts          # Web MIDI API + sustain pedal (CC 64)
    VirtualKeyboard.ts    # On-screen piano: auto-range, auto-scroll, highlights
    KeyboardInput.ts      # QWERTY → MIDI note mapping
  modes/
    PlayMode.ts           # Auto-playback with cursor sync
    PracticeMode.ts       # Wait-for-input, chords, loop, auto-advance, measure stats
  ui/
    Toolbar.ts            # Transport, mode toggle, hands, tempo, settings button
    SongLibrary.ts        # Song grid, upload, drag-drop, active indicator
    PracticeComplete.ts   # Grade overlay, stats, trouble spots, retry
    Settings.ts           # Toggle panel with skill presets (beginner/intermediate/advanced)
    NoteDisplay.ts        # Shows expected note name between score and keyboard
    CountIn.ts            # Visual beat countdown overlay
    ShortcutsHelp.ts      # Keyboard shortcuts modal (? key)
tests/
  unit/                   # Vitest: types, events, InputManager, KeyboardInput,
                          #   VirtualKeyboard, ScoreAnalyzer, PracticeMode,
                          #   PracticeModeLoop, progress, edge-cases
  e2e/                    # Playwright: app, all-songs (18), deep-practice,
                          #   repeats, settings, user-journey
public/songs/             # 18 preloaded MXL files
```

## Key Architecture Decisions
- **MXL/MusicXML only** — no PDF (OMR unreliable), no MIDI-file-only rendering
- **Custom playback scheduler** — osmd-audio-player abandoned, osmd-extended requires sponsorship
- **Hand separation via CSS** — `.staffline[id$="-2"]` opacity for dimming (OSMD can't hide individual staves)
- **`window.pianoApp` API** — exposes full programmatic control for Playwright E2E tests
- **OSMD `sheet` is protected** — accessed via `(osmd as any).sheet` in ScoreAnalyzer
- **Settings stored in localStorage** — `piano-practice-settings` key
- **Practice history in localStorage** — `piano-practice-history` key (max 500 sessions)
- **Uploaded songs in IndexedDB** — `piano-practice` DB, `uploaded-songs` store

## Testing Approach
- **Unit tests** mock OSMD, AudioEngine, ScoreRenderer — test pure logic
- **E2E tests** load real MXL files in the browser, use `window.pianoApp` API
- All 18 songs tested: load, valid timeline, practice first notes, hand filtering
- Deep practice tests: play through entire songs, verify accuracy tracking
- Edge cases: single-note songs, large chords, rapid input, empty arrays

## Important Patterns
- `ScoreAnalyzer.analyze()` iterates OSMD cursor to build `NoteEvent[]` timeline
- `PracticeMode` listens to `InputManager` events, compares against expected MIDI numbers
- `NoteEvent.notes[].staff` is 1 (treble/right) or 2 (bass/left)
- Tempo scale: slider value / 100, applied to Tone.js Transport BPM
- Count-in and auto-advance are controlled by settings, not hardcoded
- Songs from `~/Dropbox/Media/Sheet music/` copied to `public/songs/`

## Commit Convention
Use semantic commit messages:
- `feat:` new feature
- `fix:` bug fix
- `style:` visual/CSS changes
- `test:` adding/updating tests
- `refactor:` code restructuring
- `docs:` documentation
- `chore:` tooling, deps, config

## Browser Support
- Chrome/Edge/Firefox: full support (Web MIDI + Web Audio)
- Safari: no MIDI keyboard (Web MIDI API unsupported), audio works
- iPad: responsive layout with safe area insets
- iPhone: compact toolbar, hidden labels on small screens
