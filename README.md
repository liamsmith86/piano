# Piano Practice

A web app for learning piano from sheet music. Load MusicXML scores, listen to them play back with realistic piano audio, and practice note-by-note with real-time feedback.

Live demo: https://piano.everla.st

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

**17 bundled scores** are available immediately. You can also open your own
MXL/MusicXML files; those files stay in your browser and are never uploaded to
the production server.

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
bun run test        # Unit tests
bun run test:e2e    # Chromium E2E, full-playthrough, and visual tests
```

Every bundled score is analyzed and played note-by-note in automated tests.

## Privacy and production analytics

- Imported scores are stored locally in IndexedDB. Their filenames, titles,
  contents, notes, and MIDI input are never sent to the server or analytics.
- The ignored `public/songs/personal/` directory is available only to local
  development. Production builds remove it, and CI refuses to deploy if it is
  present in `dist/`.
- Production uses the existing Google Analytics property for coarse events:
  score loaded, playback started, practice started, and practice completed.
  Bundled score ids may be included; local scores are reported only as
  `score_source=local_upload`.
- Analytics runs only on `piano.everla.st` and respects Do Not Track and Global
  Privacy Control. Local development and automated tests do not send events.

## Deployment

Pushes to `main` run type checking, unit tests, a production build, the personal
song exclusion check, deployment to `/opt/piano/dist/`, a Cloudflare cache
purge, and production smoke checks through GitHub Actions.

## License

MIT — see [LICENSE](LICENSE) for details. Uses OpenSheetMusicDisplay (AGPL-3.0) as an unmodified dependency.
