import { type ReactNode, useCallback, useState } from 'react';
import { Text, View } from 'react-native';

import type { BaseItemDto } from '@/api/types';
import { useItemActions } from '@/features/actions/use-item-actions';
import { isTV } from '@/platform/tv';
import { createStyles, type AppTheme, font, iconSize, scaled, spacing, type, useStyles, useTheme } from '@/theme';

import { Icon } from './icon';
import { makeSheetStyles, Sheet, SheetRow } from './sheet';

/**
 * The item action sheet. Rows come from the item action registry, in its
 * order; destructive actions are last, in red, in their own group.
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
  const normal = actions.filter((a) => !a.destructive);
  const destructive = actions.filter((a) => a.destructive);
  const group = (list: typeof actions, first: boolean) => (
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
      <View style={s.body}>
        {normal.length ? group(normal, true) : null}
        {destructive.length ? group(destructive, normal.length === 0) : null}
        <View style={s.group}>
          <SheetRow onPress={onClose} last accessibilityLabel="Cancel">
            <Text style={s.cancel}>Cancel</Text>
          </SheetRow>
        </View>
      </View>
    </Sheet>
  );
}

const makeStyles = createStyles((t: AppTheme) => ({
  ...makeSheetStyles(t),
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
