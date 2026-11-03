import { type ReactNode, useState } from 'react';
import { Linking } from 'react-native';

import { useLocalTrailers } from '@/api/queries';
import type { BaseItemDto } from '@/api/types';
import type { IconName } from '@/components/icon';
import { OptionSheet } from '@/components/option-sheet';
import { toast } from '@/lib/toast';
import { usePlayer } from '@/player';

import { hasTrailers, type Trailer, trailerChoices } from './trailers';

export interface TrailerAction {
  /** The round "Trailer" action for the item page, or null when the item has no trailer. */
  action: { icon: IconName; label: string; onPress: () => void } | null;
  /** The trailer list, for an item with more than one trailer. Render it once on the page. */
  sheet: ReactNode;
}

/**
 * The Trailer action of a movie or show page. A trailer file on the server
 * plays in the app's player; a metadata link (YouTube) opens in the browser
 * or the YouTube app. With more than one trailer, a list opens first.
 */
export function useTrailerAction(item: BaseItemDto): TrailerAction {
  const player = usePlayer();
  const [open, setOpen] = useState(false);
  const local = useLocalTrailers(item.Id ?? undefined, (item.LocalTrailerCount ?? 0) > 0);
  const choices = trailerChoices(item, local.data);

  const play = (t: Trailer) => {
    setOpen(false);
    if (t.kind === 'local') {
      player.play({ item: t.item });
      return;
    }
    Linking.openURL(t.url).catch(() => toast('This device cannot open the trailer link.', { icon: 'exclamationmark.triangle' }));
  };

  if (!hasTrailers(item) || choices.length === 0) return { action: null, sheet: null };
  return {
    action: {
      icon: 'play.rectangle',
      label: 'Trailer',
      onPress: () => (choices.length === 1 ? play(choices[0]) : setOpen(true)),
    },
    sheet:
      choices.length > 1 ? (
        <OptionSheet
          visible={open}
          title="Trailers"
          options={choices.map((t) => ({ value: t.key, label: t.label }))}
          selected={[]}
          onSelect={(key) => {
            const t = choices.find((x) => x.key === key);
            if (t) play(t);
          }}
          onClose={() => setOpen(false)}
        />
      ) : null,
  };
}
