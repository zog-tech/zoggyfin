import { favouriteState } from '../favourite-overrides';

const liked = { Id: 'song-1', UserData: { IsFavorite: true, Key: 'song-1', ItemId: 'song-1' } };
const plain = { Id: 'song-2' };

describe('favouriteState', () => {
  it('uses the item when nothing changed in this session', () => {
    expect(favouriteState({}, 'user-1', liked)).toBe(true);
    expect(favouriteState({}, 'user-1', plain)).toBe(false);
  });

  it('prefers a change made in this session over the item copy', () => {
    expect(favouriteState({ 'user-1:song-1': false }, 'user-1', liked)).toBe(false);
    expect(favouriteState({ 'user-1:song-2': true }, 'user-1', plain)).toBe(true);
  });

  it("keeps one user's changes away from another user", () => {
    expect(favouriteState({ 'user-2:song-1': false }, 'user-1', liked)).toBe(true);
  });
});
