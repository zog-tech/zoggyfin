import { useSession } from '@/auth/session-store';
import { NowPlayingScreen } from '@/features/music-player/now-playing-screen';
import { TvNowPlaying } from '@/features/music-player/tv-now-playing';
import { AddToPlaylistHost } from '@/features/playlists/add-to-playlist';
import { isTV } from '@/platform/tv';

export default function NowPlayingRoute() {
  const session = useSession();
  return (
    <>
      {/* TV has its own player: large buttons in one row, the queue and lyrics behind a press. */}
      {isTV ? <TvNowPlaying /> : <NowPlayingScreen />}
      {/* This screen is a modal: the root's host cannot show a sheet over it (lib/top-host.ts). */}
      {session ? <AddToPlaylistHost /> : null}
    </>
  );
}
