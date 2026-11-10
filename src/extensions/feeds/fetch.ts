/**
 * Fetches one page of a feed (`GET <feed>?cursor=`, a search adds `query=`)
 * through the extension HTTP layer: the origin lock and the headers come
 * from `build` (`buildRequest`), the time limit is the feed limit (8 s).
 * The reply is read with `parseFeedPage`. Errors hold no URL.
 */
import { type BuiltRequest, FEED_TIMEOUT_MS, send } from '../http';
import { type FeedPage, parseFeedPage } from './page';
import { type FeedParams, withFeedParams } from './paging';

export async function fetchFeedPage(
  build: () => BuiltRequest,
  baseUrl: string,
  params: FeedParams,
  io: { send: (req: BuiltRequest) => Promise<unknown> } = { send: (req) => send(req, FEED_TIMEOUT_MS) },
): Promise<FeedPage> {
  return parseFeedPage(await io.send(withFeedParams(build(), params)), baseUrl);
}
