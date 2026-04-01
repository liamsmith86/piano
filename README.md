# Piano Practice

A web app for learning piano from sheet music. Load MusicXML scores, listen to them play back with realistic piano audio, and practice note-by-note with real-time feedback.

Live demo: https://play.everla.st

## Features

**Learn**
- Practice mode waits for you to play the correct note before advancing
- Wrong notes shown on the staff with note name labels
- Played notes turn green as you progress through the piece
- Per-measure accuracy tracking shows your trouble spots
- Practice complete screen with grade (A+ through F) and stats

**Play**
- Listen to any piece with Salamander Grand Piano audio
- Cursor follows along on the score in real-time
- Tempo control with 50%/75%/100% presets and slider

**Input**
- USB MIDI keyboard with sustain pedal support
- On-screen virtual piano (auto-adjusts to song range)
- Computer keyboard (QWERTY mapping, 2 octaves)

**Score Interaction**
- Click/tap anywhere on the score to jump to that measure
- Click and drag to select a range of measures for focused practice
- Hand selection: practice right hand, left hand, or both
- Accompaniment: auto-play the other hand while you practice one

**Customization**
- Settings panel with Beginner/Intermediate/Advanced presets
- Toggle: note names, next note preview, key highlights, wrong note labels, count-in, accompaniment, auto-scroll, auto-advance
- Metronome with BPM display
- Measure loop for section practice
- Practice session history with accuracy badges per song

**18 Preloaded Songs** including Bella Ciao, Runaway, Heat Waves, Young and Beautiful, Roaring Tides, Sparkle (Your Name), and more. Upload your own MXL/MusicXML files.

## Quick Start

```bash
bun install
bun dev
```

Open http://localhost:5173 (also accessible on LAN for iPad/mobile testing).

## Tech Stack

Vite + TypeScript, OpenSheetMusicDisplay, Tone.js, Web MIDI API, Tailwind CSS

## Testing

```bash
bun run test        # 179 unit tests
bun run test:e2e    # 115 E2E tests (includes full playthrough of all 18 songs)
```

294 tests total. Every preloaded song is verified note-by-note in automated tests.

## License

MIT — see [LICENSE](LICENSE) for details. Uses OpenSheetMusicDisplay (AGPL-3.0) as an unmodified dependency.
