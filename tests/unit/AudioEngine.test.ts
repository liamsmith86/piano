import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NoteEvent } from '../../src/types';

const tone = vi.hoisted(() => {
  const sampler = {
    volume: { value: 0 },
    triggerAttackRelease: vi.fn(),
    triggerAttack: vi.fn(),
    triggerRelease: vi.fn(),
    releaseAll: vi.fn(),
    dispose: vi.fn(),
    toDestination: vi.fn(),
  };
  sampler.toDestination.mockReturnValue(sampler);

  const synth = {
    triggerAttackRelease: vi.fn(),
    dispose: vi.fn(),
    toDestination: vi.fn(),
  };
  synth.toDestination.mockReturnValue(synth);

  let nextScheduleId = 1;
  const audioBuffer = {} as AudioBuffer;
  const toneBuffer = {
    get: vi.fn(() => audioBuffer),
    dispose: vi.fn(),
  };
  const transport = {
    PPQ: 192,
    bpm: { value: 120, setValueAtTime: vi.fn() },
    position: 0,
    seconds: 0,
    ticks: 0,
    loop: false,
    loopStart: 0,
    loopEnd: 0,
    schedule: vi.fn(() => nextScheduleId++),
    scheduleRepeat: vi.fn(() => nextScheduleId++),
    getTicksAtTime: vi.fn(() => 0),
    clear: vi.fn(),
    cancel: vi.fn(),
    start: vi.fn(),
    pause: vi.fn(),
    stop: vi.fn(),
  };
  const draw = { schedule: vi.fn(), cancel: vi.fn() };
  const context = {
    state: 'running',
    rawContext: null,
    resume: vi.fn().mockResolvedValue(undefined),
    setTimeout: vi.fn((callback: () => void, seconds: number) =>
      window.setTimeout(callback, seconds * 1000)),
    clearTimeout: vi.fn((id: number) => window.clearTimeout(id)),
  };

  return {
    sampler,
    synth,
    transport,
    draw,
    context,
    toneBuffer,
    fromUrl: vi.fn().mockResolvedValue(toneBuffer),
    start: vi.fn().mockResolvedValue(undefined),
    setContext: vi.fn(),
    Sampler: vi.fn(function Sampler() { return sampler; }),
    Synth: vi.fn(function Synth() { return synth; }),
  };
});

vi.mock('tone', () => ({
  Sampler: tone.Sampler,
  Synth: tone.Synth,
  ToneAudioBuffer: { fromUrl: tone.fromUrl },
  start: tone.start,
  setContext: tone.setContext,
  getContext: () => tone.context,
  getTransport: () => tone.transport,
  getDraw: () => tone.draw,
  now: () => 0,
}));

import { AudioEngine } from '../../src/audio/AudioEngine';

function makeEvent(index: number, beat: number): NoteEvent {
  return {
    index,
    timestamp: beat / 2,
    timestampBeats: beat,
    measureNumber: 1,
    notes: [{
      midi: 60 + index,
      name: 'C4',
      duration: 0.5,
      durationBeats: 1,
      velocity: 0.8,
      staff: 1,
      voice: 1,
      tied: false,
    }],
  };
}

describe('AudioEngine', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tone.fromUrl.mockResolvedValue(tone.toneBuffer);
    tone.toneBuffer.get.mockReturnValue({} as AudioBuffer);
    tone.sampler.volume.value = 0;
    tone.context.state = 'running';
  });

  it('preserves volume changes made before samples finish initializing', async () => {
    const audio = new AudioEngine();
    audio.setVolume(-6);

    await audio.init();

    expect(tone.sampler.volume.value).toBe(-6);
    expect(audio.getVolume()).toBe(-6);
  });

  it('can retry initialization without leaking a failed sampler', async () => {
    tone.fromUrl.mockRejectedValueOnce(new Error('network unavailable'));
    const audio = new AudioEngine();

    await expect(audio.init()).rejects.toThrow('network unavailable');
    expect(tone.Sampler).not.toHaveBeenCalled();

    await expect(audio.init()).resolves.toBeUndefined();
    expect(tone.Sampler).toHaveBeenCalledOnce();
    expect(audio.ready).toBe(true);
  });

  it('schedules notes and tempo changes in musical ticks', async () => {
    const audio = new AudioEngine();
    await audio.init();

    audio.schedulePlayback(
      [makeEvent(0, 0), makeEvent(1, 2)],
      'both',
      { onCursorAdvance: vi.fn(), onComplete: vi.fn() },
      {
        tempoMap: [
          { timestampBeats: 0, bpm: 120 },
          { timestampBeats: 1, bpm: 90 },
        ],
      },
    );

    expect(tone.transport.schedule.mock.calls.map(call => call[1])).toEqual([
      '192i',
      '0i',
      '384i',
      '624i',
    ]);
  });

  it('cancels a count-in immediately instead of starting playback later', async () => {
    vi.useFakeTimers();
    const audio = new AudioEngine();
    await audio.init();

    const countIn = audio.countIn(4);
    audio.cancelCountIn();

    await expect(countIn).resolves.toBe(false);
    expect(tone.synth.triggerAttackRelease).toHaveBeenCalledTimes(4);
    expect(tone.context.clearTimeout).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('releases sounding notes and queued drawing callbacks on stop', async () => {
    const audio = new AudioEngine();
    await audio.init();

    audio.stop();

    expect(tone.sampler.releaseAll).toHaveBeenCalled();
    expect(tone.draw.cancel).toHaveBeenCalled();
  });

  it('starts and releases live input notes with normalized velocity', async () => {
    const audio = new AudioEngine();
    await audio.init();

    audio.noteOn(60, 100);
    audio.noteOff(60);

    expect(tone.sampler.triggerAttack).toHaveBeenCalledWith('C4', 0, 1);
    expect(tone.sampler.triggerRelease).toHaveBeenCalledWith('C4', 0);
  });

  it('uses the transport clock for a gapless playback loop and metronome', async () => {
    const audio = new AudioEngine();
    await audio.init();
    audio.startMetronome();

    audio.schedulePlayback(
      [makeEvent(0, 0), makeEvent(1, 2)],
      'both',
      { onCursorAdvance: vi.fn(), onComplete: vi.fn() },
      { loop: true, leadInBeats: 4 },
    );

    expect(tone.transport.loop).toBe(true);
    expect(tone.transport.loopStart).toBe('768i');
    expect(tone.transport.loopEnd).toBe('1344i');
    expect(tone.transport.scheduleRepeat).toHaveBeenCalledWith(
      expect.any(Function), '4n', '768i',
    );
  });
});
