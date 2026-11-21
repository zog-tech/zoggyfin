/**
 * The app's one `ChannelHolds` (`holds.ts`): Lite mode drops the lists with `releaseChannels`.
 * The app root passes the Lite check in (`setChannelLiteCheck`), so the IPTV code does not load the
 * settings store; until then nothing is released.
 */
import { createChannelHolds } from './holds';
import { releaseChannels } from './manager';

let liteCheck: () => boolean = () => false;

/** Sets the check for Lite mode (the app root does it once). */
export function setChannelLiteCheck(check: () => boolean): void {
  liteCheck = check;
}

export const channelHolds = createChannelHolds({ release: () => void releaseChannels(), enabled: () => liteCheck() });
