/**
 * Add or edit an IPTV provider. Xtream: server address, user name and
 * password. M3U: the playlist address and an optional XMLTV guide. Both: a
 * name and an optional user agent. Save loads the channel list first, so a
 * wrong address or login says so here and nothing is saved. The edit form
 * never shows the saved password: an empty field keeps it. An admin can
 * share a provider with other users of the server. A provider shared with
 * this user is read only: the page shows who shared it and no login.
 */
import { router, Stack } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Text, View } from 'react-native';

import { Button } from '@/components/button';
import { TextField, type TextFieldRef } from '@/components/text-field';
import { TvScrollView } from '@/features/tv/page-scroll';
import { iptv, iptvErrorText, type ProviderInput, type ProviderKind, sendsUserAgent, sharedLabel, useIsAdmin } from '@/iptv';
import { confirmDestructive } from '@/lib/confirm';
import { toast } from '@/lib/toast';
import { isTV } from '@/platform/tv';
import { createStyles, type AppTheme, font, scaled, sizes, spacing, type, useStyles, useTheme } from '@/theme';

import { liveTvHref, shareHref, useLiveGroup } from './nav';

/** A provider an admin shares with this user: read only. */
function SharedProvider({ id }: { id: string }) {
  const s = useStyles(makeStyles);
  const { c } = useTheme();
  const record = iptv.provider(id);
  const [busy, setBusy] = useState(false);
  if (!record?.sharedBy) return null;
  const reload = async () => {
    setBusy(true);
    await iptv.refresh(id);
    setBusy(false);
    // A refresh never rejects: a failure leaves its text on the provider's data.
    const error = iptv.listError(id);
    if (error) toast(error, { icon: 'exclamationmark.triangle' });
    else toast('Channel list loaded', { icon: 'checkmark' });
  };
  return (
    <>
      <Stack.Screen options={{ title: record.name, headerStyle: { backgroundColor: c.bgGrouped }, contentStyle: { backgroundColor: c.bgGrouped } }} />
      <TvScrollView contentInsetAdjustmentBehavior="automatic" style={s.page} contentContainerStyle={s.content}>
        <View style={s.inner}>
          {isTV ? <Text style={s.tvTitle}>{record.name}</Text> : null}
          <Text style={s.lead}>{sharedLabel(record.sharedBy)}</Text>
          <Text style={s.note}>
            {`${record.kind === 'xtream' ? 'Xtream' : 'M3U playlist'}. Only ${record.sharedBy.name} can change or remove this provider. You can add its channels to your favourites.`}
          </Text>
          <Button title={busy ? 'Loading the channels' : 'Load the channel list again'} loading={busy} onPress={() => void reload()} />
        </View>
      </TvScrollView>
    </>
  );
}

export function ProviderForm({ id, kind }: { id?: string; kind?: ProviderKind }) {
  if (id && iptv.provider(id)?.sharedBy) return <SharedProvider id={id} />;
  return <EditProvider id={id} kind={kind} />;
}

function EditProvider({ id, kind: kindParam }: { id?: string; kind?: ProviderKind }) {
  const s = useStyles(makeStyles);
  const admin = useIsAdmin();
  const { c } = useTheme();
  const group = useLiveGroup();
  const saved = useMemo(() => (id ? iptv.formValues(id) : null), [id]);
  const kind: ProviderKind = saved?.kind ?? kindParam ?? 'xtream';
  const [name, setName] = useState(saved?.name ?? '');
  const [server, setServer] = useState(saved?.kind === 'xtream' ? saved.server : '');
  const [username, setUsername] = useState(saved?.kind === 'xtream' ? saved.username : '');
  const [password, setPassword] = useState('');
  const [playlistUrl, setPlaylistUrl] = useState(saved?.kind === 'm3u' ? saved.playlistUrl : '');
  const [guideUrl, setGuideUrl] = useState(saved?.kind === 'm3u' ? (saved.guideUrl ?? '') : '');
  const [userAgent, setUserAgent] = useState(saved?.userAgent ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const userRef = useRef<TextFieldRef>(null);
  const passRef = useRef<TextFieldRef>(null);
  const guideRef = useRef<TextFieldRef>(null);

  const title = id ? 'Edit Provider' : kind === 'xtream' ? 'Xtream Login' : 'M3U Playlist';
  const ready = kind === 'xtream' ? !!server.trim() && !!username.trim() && (!!password || !!id) : !!playlistUrl.trim();

  const save = async () => {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    const input: ProviderInput =
      kind === 'xtream'
        ? { kind, name, server, username, password, userAgent: userAgent || null }
        : { kind, name, playlistUrl, guideUrl: guideUrl || null, userAgent: userAgent || null };
    try {
      await iptv.save(input, id);
      toast(id ? 'Provider saved' : 'Provider added', { icon: 'checkmark' });
      if (id) router.back();
      else router.dismissTo(liveTvHref(group));
    } catch (e) {
      setError(iptvErrorText(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!id) return;
    if (!(await confirmDestructive('Remove provider?', 'Its channels, favourites, recently watched, films and series, watch positions, audio and subtitle choices and saved login are removed from this device.', 'Remove'))) return;
    await iptv.remove(id);
    toast('Provider removed', { icon: 'trash' });
    router.dismissTo(liveTvHref(group));
  };

  return (
    <>
      <Stack.Screen options={{ title, headerStyle: { backgroundColor: c.bgGrouped }, contentStyle: { backgroundColor: c.bgGrouped } }} />
      <KeyboardAvoidingView style={s.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <TvScrollView contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" style={s.page} contentContainerStyle={s.content}>
          <View style={s.inner}>
            {isTV ? <Text style={s.tvTitle}>{title}</Text> : null}
            <TextField
              label="Name"
              value={name}
              onChangeText={setName}
              placeholder={kind === 'xtream' ? 'Xtream' : 'Playlist'}
              autoCapitalize="words"
              returnKeyType="next"
              maxLength={60}
            />
            {kind === 'xtream' ? (
              <>
                <TextField
                  label="Server address"
                  value={server}
                  onChangeText={setServer}
                  placeholder="http://provider.example.com:8080"
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="url"
                  textContentType="URL"
                  returnKeyType="next"
                  onSubmitEditing={() => userRef.current?.focus()}
                />
                <TextField
                  ref={userRef}
                  label="User name"
                  value={username}
                  onChangeText={setUsername}
                  autoCapitalize="none"
                  autoCorrect={false}
                  textContentType="username"
                  returnKeyType="next"
                  onSubmitEditing={() => passRef.current?.focus()}
                />
                <TextField
                  ref={passRef}
                  label="Password"
                  value={password}
                  onChangeText={setPassword}
                  placeholder={id ? 'Unchanged' : undefined}
                  secureTextEntry
                  autoCapitalize="none"
                  autoCorrect={false}
                  textContentType="password"
                  returnKeyType="go"
                  onSubmitEditing={() => void save()}
                />
              </>
            ) : (
              <>
                <TextField
                  label="Playlist address"
                  value={playlistUrl}
                  onChangeText={setPlaylistUrl}
                  placeholder="https://provider.example.com/playlist.m3u"
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="url"
                  textContentType="URL"
                  returnKeyType="next"
                  onSubmitEditing={() => guideRef.current?.focus()}
                />
                <TextField
                  ref={guideRef}
                  label="Guide address (XMLTV, optional)"
                  value={guideUrl}
                  onChangeText={setGuideUrl}
                  placeholder="From the playlist when empty"
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="url"
                  textContentType="URL"
                  returnKeyType="go"
                  onSubmitEditing={() => void save()}
                />
              </>
            )}
            <TextField
              label="User agent (optional)"
              value={userAgent}
              onChangeText={setUserAgent}
              placeholder="Only when the provider asks for one"
              autoCapitalize="none"
              autoCorrect={false}
              maxLength={256}
            />
            {!sendsUserAgent && userAgent ? <Text style={s.note}>A browser cannot send its own user agent. The apps for phones, TVs and the Mac send it.</Text> : null}
            {error ? (
              <Text style={s.error} accessibilityRole="alert">
                {error}
              </Text>
            ) : null}
            <Button title={busy ? 'Loading the channels' : id ? 'Save' : 'Add provider'} loading={busy} disabled={!ready} onPress={() => void save()} />
            {busy ? <Text style={s.note}>A large list can take a minute.</Text> : null}
            {id && admin ? <Button title="Share with…" variant="text" onPress={() => router.push(shareHref(group, id))} disabled={busy} /> : null}
            {id ? <Button title="Remove provider" variant="text" onPress={() => void remove()} disabled={busy} /> : null}
          </View>
        </TvScrollView>
      </KeyboardAvoidingView>
    </>
  );
}

const makeStyles = createStyles(({ c }: AppTheme) => ({
  flex: { flex: 1 },
  page: { backgroundColor: c.bgGrouped },
  content: { padding: spacing.lg, paddingBottom: spacing.huge * 2 },
  inner: { width: '100%' as const, maxWidth: scaled(sizes.formMaxWidth), alignSelf: 'center' as const, gap: spacing.lg },
  tvTitle: { ...font(type.largeTitle), color: c.text, paddingTop: spacing.xxl },
  note: { ...font(type.footnote), color: c.text2 },
  lead: { ...font(type.headline), color: c.text },
  error: { ...font(type.callout), color: c.danger },
}));
