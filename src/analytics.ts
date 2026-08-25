import { PRELOADED_SONGS } from './types';
import type { HandSelection, SongInfo } from './types';

const MEASUREMENT_ID = 'G-N6MF5D714S';
const PRODUCTION_HOST = 'piano.everla.st';

type AnalyticsValue = string | number | boolean;
type AnalyticsParameters = Record<string, AnalyticsValue>;
type AnalyticsTransport = (event: string, parameters: AnalyticsParameters) => void;
type GoogleTag = (...args: unknown[]) => void;

declare global {
  interface Navigator {
    globalPrivacyControl?: boolean;
  }

  interface Window {
    dataLayer?: unknown[];
    gtag?: GoogleTag;
  }
}

interface PracticeContext {
  hand: HandSelection;
  looped: boolean;
}

/**
 * Small, deliberately constrained analytics facade.
 *
 * Uploaded score identifiers, filenames, titles, contents, played notes, and
 * MIDI input never cross this boundary. Only known bundled score ids and
 * coarse feature-usage context are accepted by the public methods below.
 */
export class UsageAnalytics {
  private readonly transport: AnalyticsTransport | null;

  constructor(transport: AnalyticsTransport | null) {
    this.transport = transport;
  }

  trackScoreLoaded(song: SongInfo): void {
    this.track('score_loaded', this.scoreContext(song));
  }

  trackPlaybackStarted(song: SongInfo, hand: HandSelection, looped: boolean): void {
    this.track('playback_started', {
      ...this.scoreContext(song),
      hand,
      looped,
    });
  }

  trackPracticeStarted(song: SongInfo, context: PracticeContext): void {
    this.track('practice_started', {
      ...this.scoreContext(song),
      hand: context.hand,
      looped: context.looped,
    });
  }

  trackPracticeCompleted(song: SongInfo, context: PracticeContext): void {
    this.track('practice_completed', {
      ...this.scoreContext(song),
      hand: context.hand,
      looped: context.looped,
    });
  }

  private scoreContext(song: SongInfo): AnalyticsParameters {
    const bundled = PRELOADED_SONGS.some(candidate => candidate.id === song.id);
    if (song.source === 'uploaded') return { score_source: 'local_upload' };
    return bundled
      ? { score_source: 'bundled', score_id: song.id }
      : { score_source: 'bundled' };
  }

  private track(event: string, parameters: AnalyticsParameters): void {
    try {
      this.transport?.(event, parameters);
    } catch {
      // Analytics must never interfere with loading, playback, or practice.
    }
  }
}

export function createBrowserUsageAnalytics(): UsageAnalytics {
  if (!shouldEnableAnalytics()) return new UsageAnalytics(null);

  window.dataLayer ??= [];
  window.gtag ??= function (..._args: unknown[]) {
    window.dataLayer?.push(arguments);
  };

  if (!document.querySelector(`script[data-measurement-id="${MEASUREMENT_ID}"]`)) {
    const script = document.createElement('script');
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${MEASUREMENT_ID}`;
    script.dataset.measurementId = MEASUREMENT_ID;
    document.head.append(script);
  }

  window.gtag('js', new Date());
  window.gtag('config', MEASUREMENT_ID, {
    allow_google_signals: false,
    allow_ad_personalization_signals: false,
  });

  return new UsageAnalytics((event, parameters) => {
    window.gtag?.('event', event, parameters);
  });
}

export function shouldEnableAnalytics(
  hostname = globalThis.location?.hostname,
  doNotTrack = globalThis.navigator?.doNotTrack,
  globalPrivacyControl = globalThis.navigator?.globalPrivacyControl,
): boolean {
  return hostname === PRODUCTION_HOST
    && doNotTrack !== '1'
    && globalPrivacyControl !== true;
}
