import { type ReactNode, useCallback, useState } from 'react';
import { Text, View } from 'react-native';

import type { BaseItemDto } from '@/api/types';
import { useItemActions } from '@/features/actions/use-item-actions';
import { TvScrollView } from '@/features/tv/page-scroll';
import { isTV } from '@/platform/tv';
import { actionSections, type ItemAction } from '@/registry/item-actions';
import { createStyles, type AppTheme, font, iconSize, scaled, spacing, type, useStyles, useTheme } from '@/theme';

import { Icon } from './icon';
import { makeSheetStyles, Sheet, SheetRow } from './sheet';

/**
 * The item action sheet. Rows come from the item action registry, in its
 * order, split into short groups by section (`actionSections`): play and
 * queue, library, go to, more, then the destructive ones in red.
 *
 * The groups sit in a scroll view under the sheet header. The panel has a
 * maximum height, so a list taller than that scrolls inside the sheet and
 * the header stays. A plain view here let the rows run past the panel's
 * edge, out of reach.
 */
export function ItemActionSheet({
  item,
  visible,
  onClose,
}: {
  item: BaseItemDto | undefined;
  visible: boolean;
  onClose: () => void;
}) {
  const s = useStyles(makeStyles);
  const { c } = useTheme();
  const { actions, run, titleOf } = useItemActions(item);
  const sections = actionSections(actions);
  const group = (list: ItemAction[], first: boolean) => (
    <View style={s.group}>
      {list.map((a, i) => (
        <SheetRow
          key={a.id}
          last={i === list.length - 1}
          accessibilityLabel={titleOf(a)}
          preferredFocus={isTV && first && i === 0}
          onPress={() => {
            onClose();
            run(a);
          }}>
          <Icon name={a.icon} size={scaled(iconSize.md)} color={a.destructive ? c.danger : c.text} />
          <Text style={[s.rowText, a.destructive && { color: c.danger }]}>{titleOf(a)}</Text>
        </SheetRow>
      ))}
    </View>
  );
  return (
    <Sheet visible={visible} title={item?.Name} onClose={onClose}>
      <TvScrollView style={s.list} contentContainerStyle={s.body}>
        {sections.map((sec, i) => (
          <View key={sec.key}>{group(sec.actions, i === 0)}</View>
        ))}
        <View style={s.group}>
          <SheetRow onPress={onClose} last accessibilityLabel="Cancel" preferredFocus={isTV && sections.length === 0}>
            <Text style={s.cancel}>Cancel</Text>
          </SheetRow>
        </View>
      </TvScrollView>
    </Sheet>
  );
}

const makeStyles = createStyles((t: AppTheme) => ({
  ...makeSheetStyles(t),
  // No grow, so a short sheet stays short; the scroll view still shrinks to the panel's maximum height.
  list: { flexGrow: 0 },
  body: { gap: spacing.md, paddingBottom: spacing.sm },
  cancel: { ...font(type.headline), color: t.c.text, flex: 1, textAlign: 'center' as const },
}));

/**
 * One item action sheet for a row or a grid of tiles: `open(item)` shows it.
 * The sheet mounts on the first open (a Home page has many rows) and then
 * stays mounted, so it can play its exit animation. `open` is stable, for
 * memo tiles.
 */
export function useItemMenu(): { open: (item: BaseItemDto) => void; sheet: ReactNode } {
  const [item, setItem] = useState<BaseItemDto>();
  const [visible, setVisible] = useState(false);
  const open = useCallback((it: BaseItemDto) => {
    setItem(it);
    setVisible(true);
  }, []);
  const close = useCallback(() => setVisible(false), []);
  const sheet = item ? <ItemActionSheet item={item} visible={visible} onClose={close} /> : null;
  return { open, sheet };
}
