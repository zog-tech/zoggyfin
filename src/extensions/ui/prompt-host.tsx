/**
 * Shows the questions of an extension action (see prompts.ts) in a sheet:
 * a confirm, a text field, or a choice list that loads from the extension.
 */
import { useEffect, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';

import { Button } from '@/components/button';
import { Icon } from '@/components/icon';
import { makeSheetStyles, Sheet, SheetRow } from '@/components/sheet';
import { TextField } from '@/components/text-field';
import { TvScrollView } from '@/features/tv/page-scroll';
import { createStyles, type AppTheme, font, iconSize, scaled, spacing, type, useStyles, useTheme } from '@/theme';

import { type ChoiceOption, type Prompt, usePrompt } from '../prompts';

export function ExtensionPromptHost() {
  const current = usePrompt((st) => st.current);
  const cancel = () => {
    if (!current) return;
    if (current.kind === 'confirm') current.resolve(false);
    else current.resolve(null);
  };
  return (
    <Sheet visible={!!current} title={current?.title ?? ''} onClose={cancel}>
      {current ? <Body key={current.id} prompt={current} onCancel={cancel} /> : null}
    </Sheet>
  );
}

function Body({ prompt, onCancel }: { prompt: Prompt; onCancel: () => void }) {
  const s = useStyles(makeStyles);
  return (
    <View style={s.body}>
      {prompt.message ? <Text style={s.message}>{prompt.message}</Text> : null}
      {prompt.kind === 'confirm' ? (
        <View style={s.buttons}>
          <Button title={prompt.action} onPress={() => prompt.resolve(true)} />
          <Button title="Cancel" variant="tonal" onPress={onCancel} />
        </View>
      ) : prompt.kind === 'text' ? (
        <TextPrompt prompt={prompt} onCancel={onCancel} />
      ) : (
        <ChoicePrompt prompt={prompt} />
      )}
    </View>
  );
}

function TextPrompt({ prompt, onCancel }: { prompt: Extract<Prompt, { kind: 'text' }>; onCancel: () => void }) {
  const s = useStyles(makeStyles);
  const [value, setValue] = useState(prompt.initial ?? '');
  const submit = () => (value.trim() ? prompt.resolve(value.trim()) : undefined);
  return (
    <>
      <TextField
        label={prompt.title}
        value={value}
        onChangeText={setValue}
        placeholder={prompt.placeholder}
        autoFocus
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="done"
        onSubmitEditing={submit}
      />
      <View style={s.buttons}>
        <Button title="Continue" onPress={submit} disabled={!value.trim()} />
        <Button title="Cancel" variant="tonal" onPress={onCancel} />
      </View>
    </>
  );
}

function ChoicePrompt({ prompt }: { prompt: Extract<Prompt, { kind: 'choice' }> }) {
  const s = useStyles(makeStyles);
  const { c } = useTheme();
  const [state, setState] = useState<{ options?: ChoiceOption[]; error?: string }>({});
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    prompt
      .load()
      .then((options) => live && setState({ options }))
      .catch((e: unknown) => live && setState({ error: e instanceof Error ? e.message : 'The list did not load.' }));
    return () => {
      live = false;
    };
  }, [prompt, attempt]);

  if (state.error) {
    return (
      <View style={s.center}>
        <Text style={s.message}>{state.error}</Text>
        <Button
          title="Try again"
          variant="tonal"
          onPress={() => {
            setState({});
            setAttempt((n) => n + 1);
          }}
        />
      </View>
    );
  }
  if (!state.options) {
    return (
      <View style={s.center}>
        <ActivityIndicator color={c.text2} accessibilityLabel="Loading" />
      </View>
    );
  }
  const options = state.options;
  return (
    <TvScrollView style={s.list}>
      {options.length === 0 ? <Text style={s.message}>No options</Text> : null}
      <View style={s.group}>
        {options.map((o, i) => {
          const on = o.value === prompt.initial;
          return (
            <SheetRow key={o.value} last={i === options.length - 1} accessibilityRole="radio" accessibilityLabel={o.label} checked={on} onPress={() => prompt.resolve(o.value)}>
              <Text style={[s.rowText, on && s.rowOn]} numberOfLines={1}>
                {o.label}
              </Text>
              {on ? <Icon name="checkmark" size={scaled(iconSize.sm)} color={c.accent} weight="semibold" /> : null}
            </SheetRow>
          );
        })}
      </View>
    </TvScrollView>
  );
}

const makeStyles = createStyles((t: AppTheme) => ({
  ...makeSheetStyles(t),
  body: { gap: spacing.lg, paddingBottom: spacing.md },
  message: { ...font(type.subheadline), color: t.c.text2 },
  buttons: { gap: spacing.sm },
  center: { alignItems: 'center' as const, gap: spacing.md, paddingVertical: spacing.xl },
  list: { flexGrow: 0 },
  rowOn: { color: t.c.accent },
}));
