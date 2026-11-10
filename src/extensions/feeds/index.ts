/**
 * Feeds: entries, paged feed replies and entry detail pages. All parsers are
 * pure and apply the origin rule of `match.ts`.
 */
export { MEDIA_KINDS, entrySchema, mediaRefSchema, readEntry, readMediaRef, type FeedEntry, type MediaKind, type MediaRef } from './entry';
export { MAX_CURSOR_LENGTH, MAX_FEED_ITEMS, feedSchema, parseFeed, parseFeedPage, type FeedPage } from './page';
export { MAX_DETAIL_ACTIONS, MAX_DETAIL_LINES, detailActionSchema, parseDetail, type ActionState, type DetailAction, type DetailDescription } from './detail';
