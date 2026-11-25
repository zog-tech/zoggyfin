import { type ComponentRef, type Ref, useState } from 'react';
import { Text, TextInput, type TextInputProps, View } from 'react-native';

import { isTV } from '@/platform/tv';
import { isTvModern } from '@/platform/tv-look-now';
import { createStyles, type AppTheme, font, mediaColors, radius, scaled, sizes, spacing, tv, tvFont, tvm, type, u, useStyles, useTheme } from '@/theme';

/** TV Modern (design system §7.22): radius 8 u, a 2 u edge, 30 u text; the focus is a 4 u white border. */
const MODERN = isTV && isTvModern;

export type TextFieldRef = ComponentRef<typeof TextInput>;

/**
 * A labelled text field: `surface` fill, a `controlBorder` edge (3:1), `accent`
 * caret. TV: the focused field has a white edge, like the focus ring of the
 * other controls, so the remote shows where it is.
 */
export function TextField({
  label,
  style,
  ref,
  ...props
}: Omit<TextInputProps, 'ref'> & { label: string; ref?: Ref<TextFieldRef> }) {
  const s = useStyles(makeStyles);
  const { c, scheme } = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <View style={s.wrap}>
      <Text style={[s.label, MODERN && s.labelModern]}>{label}</Text>
      <TextInput
        ref={ref}
        placeholderTextColor={c.text3}
        selectionColor={c.accent}
        cursorColor={c.accent}
        style={MODERN ? [s.input, s.inputModern, style, focused && s.inputFocusedModern] : [s.input, style, isTV && focused && s.inputFocusedTV]}
        keyboardAppearance={scheme}
        {...props}
        onFocus={(e) => {
          setFocused(true);
          props.onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          props.onBlur?.(e);
        }}
      />
    </View>
  );
}

const makeStyles = createStyles(({ c }: AppTheme) => ({
  wrap: { gap: spacing.xs + 2 },
  label: { ...font(type.footnote), fontWeight: '500' as const, color: c.text2 },
  input: {
    ...font(type.body),
    color: c.text,
    backgroundColor: c.surface,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    minHeight: scaled(sizes.fieldHeight),
    borderWidth: 1,
    borderColor: c.controlBorder,
    borderCurve: 'continuous' as const,
  },
  inputFocusedTV: { borderWidth: tv.focusRingWidth, borderColor: mediaColors.white, paddingHorizontal: spacing.lg - (tv.focusRingWidth - 1) },
  labelModern: { ...tvFont(tvm.type.meta), color: c.text2 },
  inputModern: {
    ...tvFont(tvm.type.body),
    fontSize: u(30),
    backgroundColor: c.surface2,
    borderRadius: u(tvm.size.plateRadius),
    borderWidth: u(2),
    minHeight: u(72),
    paddingHorizontal: u(24),
  },
  // The wider edge eats into the padding, so the text does not move.
  inputFocusedModern: { borderWidth: u(4), borderColor: mediaColors.white, paddingHorizontal: u(22) },
}));
