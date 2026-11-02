import { Text, View } from 'react-native';

import { TvScrollView } from '@/features/tv/page-scroll';
import { isTV } from '@/platform/tv';
import { createStyles, type AppTheme, font, iconSize, scaled, spacing, type, useStyles, useTheme } from '@/theme';

import { Icon } from './icon';
import { makeSheetStyles, Sheet, SheetRow } from './sheet';

export interface Option<T> {
  value: T;
  label: string;
}

/** A sheet to pick one or more options. The selected rows have an `accent` checkmark. */
export function OptionSheet<T>({
  visible,
  title,
  options,
  selected,
  multiple,
  onSelect,
  onClose,
}: {
  visible: boolean;
  title: string;
  options: Option<T>[];
  selected: readonly T[];
  multiple?: boolean;
  onSelect: (value: T) => void;
  onClose: () => void;
}) {
  const s = useStyles(makeStyles);
  const { c } = useTheme();
  return (
    <Sheet visible={visible} title={title} onClose={onClose} doneLabel="Done">
      <TvScrollView style={s.list} contentContainerStyle={s.content}>
        {options.length === 0 ? <Text style={s.empty}>No options</Text> : null}
        <View style={s.group}>
          {options.map((o, i) => {
            const on = selected.includes(o.value);
            return (
              <SheetRow
                key={String(o.value)}
                last={i === options.length - 1}
                accessibilityRole={multiple ? 'checkbox' : 'radio'}
                accessibilityLabel={o.label}
                checked={on}
                preferredFocus={isTV && (on || (i === 0 && selected.length === 0))}
                onPress={() => {
                  onSelect(o.value);
                  if (!multiple) onClose();
                }}>
                <Text style={[s.rowText, on && s.rowOn]} numberOfLines={1}>
                  {o.label}
                </Text>
                {on ? <Icon name="checkmark" size={scaled(iconSize.sm)} color={c.accent} weight="semibold" /> : null}
              </SheetRow>
            );
          })}
        </View>
      </TvScrollView>
    </Sheet>
  );
}

const makeStyles = createStyles((t: AppTheme) => ({
  ...makeSheetStyles(t),
  list: { flexGrow: 0 },
  content: { paddingBottom: spacing.sm },
  empty: { ...font(type.subheadline), color: t.c.text2, padding: spacing.xl, textAlign: 'center' as const },
  rowOn: { color: t.c.accent },
}));
