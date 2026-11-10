/**
 * Home row feeds. A feed is `{ "items": [...] }`; each entry is a Jellyfin
 * item (`itemId`) or a plain card. The parsers live in `feeds/`; this file
 * keeps the import path of the Home row.
 */
export { feedSchema, parseFeed, type FeedEntry } from './feeds';
