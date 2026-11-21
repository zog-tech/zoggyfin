import { applyLiteQueryCache, LITE_GC_TIME, queryClient } from '../query-client';

jest.mock('@/storage/kv', () => ({ cacheStorage: { getString: () => undefined, set: () => undefined, remove: () => undefined, clearAll: () => undefined } }));

describe('applyLiteQueryCache', () => {
  afterEach(() => {
    applyLiteQueryCache(false);
    queryClient.clear();
  });

  it('keeps closed pages 5 minutes in Lite mode and 7 days otherwise', async () => {
    await queryClient.prefetchQuery({ queryKey: ['jf', 's', 'u', 'item', '1'], queryFn: () => 1 });
    applyLiteQueryCache(true);
    expect(queryClient.getDefaultOptions().queries?.gcTime).toBe(LITE_GC_TIME);
    expect(queryClient.getQueryCache().getAll()[0]?.options.gcTime).toBe(LITE_GC_TIME);
    applyLiteQueryCache(false);
    expect(queryClient.getDefaultOptions().queries?.gcTime).toBe(7 * 24 * 60 * 60 * 1000);
  });
});
