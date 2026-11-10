/**
 * The body of a progress report (`POST report.path` of a stream
 * description). The player sends one on start, every `intervalSeconds`,
 * on pause, resume, seek and stop, and at the end.
 *
 * Rules:
 * - Times are seconds, rounded to 0.1 s, never negative.
 * - `duration` is left out when it is not known (a live stream).
 * - `quality` is the id of the chosen quality, left out when there is none.
 *
 * Pure, so it is unit-tested.
 */
export const REPORT_EVENTS = ['start', 'progress', 'pause', 'resume', 'seek', 'stop', 'finished'] as const;
export type ReportEvent = (typeof REPORT_EVENTS)[number];

export interface ReportInput {
  event: ReportEvent;
  mediaId: string;
  position: number;
  duration?: number | null;
  rate?: number;
  quality?: string | null;
  /** True when the report comes from a download played with no connection. */
  offline?: boolean;
}

export interface ReportBody {
  event: ReportEvent;
  mediaId: string;
  position: number;
  duration?: number;
  rate: number;
  quality?: string;
  offline: boolean;
}

const tenths = (s: number) => Math.round(s * 10) / 10;

export function buildReport(input: ReportInput): ReportBody {
  const position = Number.isFinite(input.position) ? Math.max(0, tenths(input.position)) : 0;
  const body: ReportBody = {
    event: input.event,
    mediaId: input.mediaId,
    position,
    rate: input.rate !== undefined && Number.isFinite(input.rate) && input.rate > 0 ? input.rate : 1,
    offline: input.offline === true,
  };
  if (input.duration != null && Number.isFinite(input.duration) && input.duration > 0) body.duration = tenths(input.duration);
  if (input.quality) body.quality = input.quality;
  return body;
}
