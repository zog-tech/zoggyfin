/**
 * Feeds: entries, paged feed replies and entry detail pages. All parsers are
 * pure and apply the origin rule of `match.ts`.
 */
export { MEDIA_KINDS, entrySchema, mediaRefSchema, readEntry, readMediaRef, type FeedEntry, type MediaKind, type MediaRef } from './entry';
export { MAX_CURSOR_LENGTH, MAX_FEED_ITEMS, feedSchema, parseFeed, parseFeedPage, type FeedPage } from './page';
export { MAX_DETAIL_ACTIONS, MAX_DETAIL_LINES, detailActionSchema, parseDetail, type ActionState, type DetailAction, type DetailDescription } from './detail';
export {
  MAX_FEED_PAGES,
  MAX_QUERY_LENGTH,
  SEARCH_DEBOUNCE_MS,
  StaleSearchError,
  entryDetailKey,
  extensionFeedsKey,
  feedQueryKey,
  flattenPages,
  isCapped,
  latestOnly,
  nextCursor,
  normalizeQuery,
  withFeedParams,
  type FeedParams,
  type LoadedPage,
} from './paging';
export { fetchDetail, fetchFeedPage } from './fetch';
