import { describe, expect, it, vi } from 'vitest';
import { UsageAnalytics, shouldEnableAnalytics } from '../../src/analytics';
import { PRELOADED_SONGS } from '../../src/types';
import type { SongInfo } from '../../src/types';

describe('UsageAnalytics', () => {
  it('reports known bundled score ids', () => {
    const transport = vi.fn();
    const analytics = new UsageAnalytics(transport);

    analytics.trackScoreLoaded(PRELOADED_SONGS[0]);

    expect(transport).toHaveBeenCalledWith('score_loaded', {
      score_source: 'bundled',
      score_id: PRELOADED_SONGS[0].id,
    });
  });

  it('never reports identifying metadata for a local upload', () => {
    const transport = vi.fn();
    const analytics = new UsageAnalytics(transport);
    const uploadedSong: SongInfo = {
      id: 'upload-private-id',
      title: 'My Private Song Name',
      url: '',
      source: 'uploaded',
    };

    analytics.trackScoreLoaded(uploadedSong);
    analytics.trackPracticeStarted(uploadedSong, { hand: 'both', looped: false });

    const serializedCalls = JSON.stringify(transport.mock.calls);
    expect(serializedCalls).not.toContain(uploadedSong.id);
    expect(serializedCalls).not.toContain(uploadedSong.title);
    expect(transport).toHaveBeenNthCalledWith(1, 'score_loaded', {
      score_source: 'local_upload',
    });
    expect(transport).toHaveBeenNthCalledWith(2, 'practice_started', {
      score_source: 'local_upload',
      hand: 'both',
      looped: false,
    });
  });

  it('reports coarse playback and completion context', () => {
    const transport = vi.fn();
    const analytics = new UsageAnalytics(transport);
    const song = PRELOADED_SONGS[1];

    analytics.trackPlaybackStarted(song, 'right', true);
    analytics.trackPracticeCompleted(song, { hand: 'left', looped: false });

    expect(transport).toHaveBeenNthCalledWith(1, 'playback_started', {
      score_source: 'bundled',
      score_id: song.id,
      hand: 'right',
      looped: true,
    });
    expect(transport).toHaveBeenNthCalledWith(2, 'practice_completed', {
      score_source: 'bundled',
      score_id: song.id,
      hand: 'left',
      looped: false,
    });
  });

  it('cannot disrupt the app when the analytics transport fails', () => {
    const analytics = new UsageAnalytics(() => {
      throw new Error('blocked');
    });

    expect(() => analytics.trackScoreLoaded(PRELOADED_SONGS[0])).not.toThrow();
  });
});

describe('shouldEnableAnalytics', () => {
  it('only enables analytics on production without a privacy opt-out', () => {
    expect(shouldEnableAnalytics('piano.everla.st', '0', false)).toBe(true);
    expect(shouldEnableAnalytics('localhost', '0', false)).toBe(false);
    expect(shouldEnableAnalytics('piano.everla.st', '1', false)).toBe(false);
    expect(shouldEnableAnalytics('piano.everla.st', '0', true)).toBe(false);
  });
});
