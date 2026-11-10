import { Linking } from 'react-native';

import { openExternalUrl } from '../open-external';

describe('openExternalUrl (iPhone, iPad, Android)', () => {
  afterEach(() => jest.restoreAllMocks());

  it('opens the URL with the system and answers true', async () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    expect(await openExternalUrl('https://example.org/a')).toBe(true);
    expect(open).toHaveBeenCalledWith('https://example.org/a');
  });

  it('answers false when the system cannot open it', async () => {
    jest.spyOn(Linking, 'openURL').mockRejectedValue(new Error('no handler'));
    expect(await openExternalUrl('https://example.org/a')).toBe(false);
  });
});
