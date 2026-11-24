import { urlWithoutLook } from '../restart';

describe('restart on the web', () => {
  it('drops only the look parameter, so the saved choice decides after the reload', () => {
    expect(urlWithoutLook('http://localhost:8084/settings?tv=1&tvlook=classic')).toBe('http://localhost:8084/settings?tv=1');
    expect(urlWithoutLook('http://localhost:8084/?tvlook=modern')).toBe('http://localhost:8084/');
    expect(urlWithoutLook('http://localhost:8084/item/1?type=Movie')).toBe('http://localhost:8084/item/1?type=Movie');
  });
  it('keeps a value it cannot read', () => {
    expect(urlWithoutLook('not a url')).toBe('not a url');
  });
});
