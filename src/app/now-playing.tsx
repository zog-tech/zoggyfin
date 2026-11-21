import { NowPlayingScreen } from '@/features/music-player/now-playing-screen';
import { TvNowPlaying } from '@/features/music-player/tv-now-playing';
import { isTV } from '@/platform/tv';

export default function NowPlayingRoute() {
  // TV has its own player: large buttons in one row, the queue and lyrics behind a press.
  return isTV ? <TvNowPlaying /> : <NowPlayingScreen />;
}
