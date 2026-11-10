/**
 * Extension media: the stream description, the progress report body and
 * the download description. All parsers are pure and apply the origin rule
 * of `match.ts`.
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
export { MAX_DOWNLOAD_OPTIONS, MAX_DOWNLOAD_SUBTITLES, parseDownloadDescription, type DownloadDescription, type DownloadOption, type DownloadSubtitle } from './download';
