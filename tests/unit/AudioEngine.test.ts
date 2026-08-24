import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NoteEvent } from '../../src/types';

const tone = vi.hoisted(() => {
  const sampler = {
    volume: { value: 0 },
    triggerAttackRelease: vi.fn(),
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
  const transport = {
    PPQ: 192,
    bpm: { value: 120, setValueAtTime: vi.fn() },
    position: 0,
    seconds: 0,
    schedule: vi.fn(() => nextScheduleId++),
    clear: vi.fn(),
    cancel: vi.fn(),
    start: vi.fn(),
    pause: vi.fn(),
    stop: vi.fn(),
  };
  const draw = { schedule: vi.fn(), cancel: vi.fn() };
  const context = { state: 'running', resume: vi.fn().mockResolvedValue(undefined) };

  return {
    sampler,
    synth,
    transport,
    draw,
    context,
    loaded: vi.fn().mockResolvedValue(undefined),
    start: vi.fn().mockResolvedValue(undefined),
    Sampler: vi.fn(function Sampler() { return sampler; }),
    Synth: vi.fn(function Synth() { return synth; }),
  };
});

vi.mock('tone', () => ({
  Sampler: tone.Sampler,
  Synth: tone.Synth,
  loaded: tone.loaded,
  start: tone.start,
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
    tone.loaded.mockResolvedValue(undefined);
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
    tone.loaded.mockRejectedValueOnce(new Error('network unavailable'));
    const audio = new AudioEngine();

    await expect(audio.init()).rejects.toThrow('network unavailable');
    expect(tone.sampler.dispose).toHaveBeenCalledOnce();

    await expect(audio.init()).resolves.toBeUndefined();
    expect(tone.Sampler).toHaveBeenCalledTimes(2);
    expect(audio.ready).toBe(true);
  });

  it('schedules notes and tempo changes in musical ticks', async () => {
    const audio = new AudioEngine();
    await audio.init();

    audio.schedulePlayback(
      [makeEvent(0, 0), makeEvent(1, 2)],
      'both',
      vi.fn(),
      vi.fn(),
      [
        { timestampBeats: 0, bpm: 120 },
        { timestampBeats: 1, bpm: 90 },
      ],
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
    expect(tone.synth.triggerAttackRelease).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });

  it('releases sounding notes and queued drawing callbacks on stop', async () => {
    const audio = new AudioEngine();
    await audio.init();

    audio.stop();

    expect(tone.sampler.releaseAll).toHaveBeenCalled();
    expect(tone.draw.cancel).toHaveBeenCalled();
  });
});
