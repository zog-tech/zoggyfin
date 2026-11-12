/**
 * Extension media: the stream description, the progress report body, the
 * download description and the player's source for extension media. All
 * parsers are pure and apply the origin rule of `match.ts`. The app wiring
 * of the source is in `play.ts` (not exported here: it loads the runtime).
 */
export {
  MAX_ALTERNATIVES,
  MAX_CHAPTERS,
  MAX_QUALITIES,
  MAX_SEGMENTS,
  MAX_SUBTITLES,
  REPORT_INTERVAL_DEFAULT,
  parseStreamDescription,
  type StreamChapter,
  type StreamDescription,
  type StreamQuality,
  type StreamReport,
  type StreamSegment,
  type StreamSource,
  type StreamSubtitle,
  type StreamType,
} from './describe';
export { REPORT_EVENTS, buildReport, type ReportBody, type ReportEvent, type ReportInput } from './report';
export { MAX_DOWNLOAD_OPTIONS, MAX_DOWNLOAD_SUBTITLES, PREFER_ASYNC, parseDownloadDescription, parsePreparing, type DownloadDescription, type DownloadOption, type DownloadSubtitle, type PreparingReply } from './download';
export { extensionSource, mediaItemId, mediaPlayRequest, safeText, skipDefaults, skipTitle, streamFromDescription, streamHeaders, type ExtensionMediaDeps } from './source';
