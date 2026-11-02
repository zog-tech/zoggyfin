/**
 * Logs: the log files of the server and a read-only monospace viewer with
 * search. The viewer loads a file in parts of 256 KB as the list scrolls,
 * so a large log does not load at once.
 */
import type { LogFile } from '@jellyfin/sdk/lib/generated-client/models';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Platform, Text, TextInput, View } from 'react-native';

import { describeError } from '@/api/errors';
import { Button } from '@/components/button';
import { Icon } from '@/components/icon';
import { EmptyState, ErrorState, LoadingState } from '@/components/states';
import { Group, LeadingIcon, makeSettingsStyles } from '@/features/settings/rows';
import { Touchable } from '@/components/touchable';
import { TvScrollView } from '@/features/tv/page-scroll';
import { isTV } from '@/platform/tv';
import { useDebounced } from '@/lib/use-debounced';
import { formatBytes } from '@/lib/format';
import { createStyles, type AppTheme, font, iconSize, radius, scaled, sizes, spacing, type, useStyles, useTheme, webInput } from '@/theme';
import { useSidebarInset } from '@/theme/sidebar-inset';

import type { AdminTarget } from './access';
import { appendLogChunk, formatSince, logLineLevel, nextLogRange, searchLines } from './logic';
import { openAdminLog } from './nav';
import { useLogFiles } from './queries';
import { useAdminWide } from './ui';
import { useTabBottomPadding } from '@/lib/tab-bar-inset';

const MONO = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' });

function sortLogs(list: readonly LogFile[]): LogFile[] {
  return [...list].sort((a, b) => Date.parse(b.DateModified ?? '') - Date.parse(a.DateModified ?? '') || 0);
}

/** The list of log files. `onOpen` replaces the default (push the viewer screen). */
export function LogsSection({ target, selected, onOpen }: { target: AdminTarget; selected?: string | null; onOpen?: (name: string) => void }) {
  const q = useLogFiles(target);
  const rs = useStyles(makeSettingsStyles);
  const s = useStyles(makeStyles);
  const { c } = useTheme();
  if (q.isPending) return <LoadingState rows={5} />;
  if (q.isError && !q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const list = sortLogs(q.data);
  if (list.length === 0) return <EmptyState icon="doc.text" title="No log files" />;
  return (
    <Group title={`Log files · ${list.length}`} footer="Logs can contain user names and addresses of your network. Share them with care.">
      {list.map((f, i) => {
        const on = selected === f.Name;
        return (
          <Touchable
            key={f.Name}
            kind="row"
            onPress={() => (onOpen ? onOpen(f.Name) : openAdminLog(target.serverId, f.Name))}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            accessibilityLabel={`${f.Name}, ${formatBytes(f.Size ?? 0)}, changed ${formatSince(f.DateModified, new Date()) ?? ''}`}
            style={({ pressed, hovered, focused }) => [rs.rowPad, (pressed || hovered || (focused && !isTV)) && rs.rowPressed, on && { backgroundColor: c.accentSoft }]}>
            <LeadingIcon name="doc.text" />
            <View style={[rs.row, rs.rowBody, i < list.length - 1 && rs.rowBorder]}>
              <View style={s.fileText}>
                <Text style={s.fileName} numberOfLines={1} ellipsizeMode="middle">
                  {f.Name}
                </Text>
                <Text style={s.fileMeta}>{`${formatBytes(f.Size ?? 0)} · changed ${formatSince(f.DateModified, new Date()) ?? 'unknown'}`}</Text>
              </View>
              <Icon name="chevron.right" size={scaled(iconSize.sm - 2)} color={c.text3} weight="semibold" />
            </View>
          </Touchable>
        );
      })}
    </Group>
  );
}

/** Wide windows: the file list and the viewer side by side, each with its own scroll. */
export function LogsSplit({ target }: { target: AdminTarget }) {
  const s = useStyles(makeStyles);
  const sidebar = useSidebarInset();
  const files = useLogFiles(target);
  const [name, setName] = useState<string | null>(null);
  const first = files.data ? sortLogs(files.data)[0]?.Name : undefined;
  const current = name ?? first ?? null;
  return (
    <View style={[s.split, sidebar ? { paddingLeft: sidebar } : null]}>
      <TvScrollView style={s.splitList} contentContainerStyle={s.splitListContent}>
        <LogsSection target={target} selected={current} onOpen={setName} />
      </TvScrollView>
      <View style={s.splitViewer}>{current ? <LogViewer key={current} target={target} name={current} /> : <EmptyState icon="doc.text" title="No log file" />}</View>
    </View>
  );
}

interface LogState {
  lines: string[];
  carry: string;
  loadedBytes: number;
  total: number | null;
  done: boolean;
}

const EMPTY: LogState = { lines: [], carry: '', loadedBytes: 0, total: null, done: false };

/** One log file, read-only, in a monospace font. */
export function LogViewer({ target, name }: { target: AdminTarget; name: string }) {
  const s = useStyles(makeStyles);
  const bottomPad = useTabBottomPadding(spacing.huge, { autoInset: false });
  const { c } = useTheme();
  const wide = useAdminWide();
  const [st, setSt] = useState<LogState>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [query, setQuery] = useState('');
  const q = useDebounced(query, 250);
  const busy = useRef(false);
  // The latest state for loadMore; it changes only together with `st`.
  const stRef = useRef(EMPTY);
  const list = useRef<FlatList<number>>(null);

  /** Loads the next part. Returns false at the end of the file or on an error. */
  const loadMore = useCallback(async (): Promise<boolean> => {
    const cur = stRef.current;
    if (busy.current || cur.done) return false;
    const range = nextLogRange(cur.loadedBytes, cur.total);
    if (!range) return false;
    busy.current = true;
    setLoading(true);
    setError(null);
    try {
      const chunk = await target.api.logChunk(name, range.start, range.end);
      const next = appendLogChunk(cur, chunk.text, chunk.done);
      const updated = { ...next, loadedBytes: cur.loadedBytes + chunk.bytes, total: chunk.total, done: chunk.done || chunk.bytes === 0 };
      stRef.current = updated;
      setSt(updated);
      return !updated.done;
    } catch (e) {
      setError(e);
      return false;
    } finally {
      busy.current = false;
      setLoading(false);
    }
  }, [target, name]);

  const loadAll = useCallback(async () => {
    // One part after the other; stops at the end or at the first error.
    while (await loadMore()) {
      /* next part */
    }
  }, [loadMore]);

  // The first part loads when the viewer opens. A new file gets a new viewer (key).
  useEffect(() => {
    void loadMore();
  }, [loadMore]);

  const matches = useMemo(() => searchLines(st.lines, q), [st.lines, q]);
  const searching = q.trim().length > 0;
  const rows = useMemo(() => (searching ? matches : st.lines.map((_, i) => i)), [searching, matches, st.lines]);

  const renderItem = useCallback(
    ({ item }: { item: number }) => {
      const line = st.lines[item];
      const level = logLineLevel(line);
      return (
        <View style={s.line}>
          <Text style={s.num} selectable={false}>
            {item + 1}
          </Text>
          <Text style={[s.code, level === 'error' ? { color: c.danger } : level === 'warning' ? { color: c.warning } : null]} selectable>
            {line || ' '}
          </Text>
        </View>
      );
    },
    [st.lines, s, c],
  );

  if (st.lines.length === 0 && loading && !error) return <LoadingState rows={8} />;
  if (st.lines.length === 0 && error) return <ErrorState error={error} onRetry={() => void loadMore()} />;

  const progress = st.total ? `${formatBytes(st.loadedBytes)} of ${formatBytes(st.total)}` : formatBytes(st.loadedBytes);
  return (
    <View style={s.viewer}>
      <View style={[s.toolbar, wide && s.toolbarWide]}>
        <View style={s.search}>
          <Icon name="magnifyingglass" size={scaled(iconSize.sm)} color={c.text3} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search in the log"
            placeholderTextColor={c.text3}
            style={[s.searchInput, webInput]}
            autoCapitalize="none"
            autoCorrect={false}
            clearButtonMode="while-editing"
            accessibilityLabel="Search in the log"
            returnKeyType="search"
          />
        </View>
        <Text style={s.status} accessibilityLiveRegion="polite">
          {searching
            ? `${matches.length} ${matches.length === 1 ? 'line' : 'lines'} found${st.done ? '' : ' in the loaded part'}`
            : `${st.lines.length} lines · ${progress}${st.done ? '' : ' loaded'}`}
        </Text>
        {!st.done ? <Button title="Load the whole file" variant="smallTonal" loading={loading} onPress={() => void loadAll()} /> : null}
      </View>
      <FlatList
        ref={list}
        data={rows}
        keyExtractor={(i) => String(i)}
        renderItem={renderItem}
        initialNumToRender={60}
        maxToRenderPerBatch={80}
        windowSize={11}
        onEndReachedThreshold={1.5}
        onEndReached={() => {
          if (!searching) void loadMore();
        }}
        contentContainerStyle={[s.listContent, { paddingBottom: bottomPad }]}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={<Text style={s.status}>{searching ? 'No line contains this text.' : 'The file is empty.'}</Text>}
        ListFooterComponent={
          error ? (
            <View style={s.footer}>
              <Text style={s.errorText}>{`${describeError(error).title}. The rest of the file did not load.`}</Text>
              <Button title="Retry" variant="smallTonal" icon="arrow.clockwise" onPress={() => void loadMore()} />
            </View>
          ) : loading ? (
            <Text style={s.status}>Loading</Text>
          ) : st.done && !searching ? (
            <Text style={s.status}>End of file</Text>
          ) : undefined
        }
      />
    </View>
  );
}

const makeStyles = createStyles(({ c }: AppTheme) => ({
  fileText: { flex: 1, gap: 2, minWidth: 0 },
  fileName: { ...font(type.subheadline), fontFamily: MONO, color: c.text },
  fileMeta: { ...font(type.footnote, { tabular: true }), color: c.text2 },
  split: { flex: 1, flexDirection: 'row' as const, backgroundColor: c.bgGrouped },
  splitList: { width: 380, flexGrow: 0, borderRightWidth: sizes.hairline, borderRightColor: c.separator },
  splitListContent: { padding: spacing.lg },
  splitViewer: { flex: 1 },
  viewer: { flex: 1, backgroundColor: c.bg },
  toolbar: { padding: spacing.md, gap: spacing.sm, backgroundColor: c.bgGrouped, borderBottomWidth: sizes.hairline, borderBottomColor: c.separator },
  toolbarWide: { flexDirection: 'row' as const, alignItems: 'center' as const, flexWrap: 'wrap' as const },
  search: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: spacing.sm,
    backgroundColor: c.surface2,
    borderRadius: radius.md + 2,
    paddingHorizontal: spacing.md,
    minHeight: sizes.webSearchHeight,
    flexGrow: 1,
    minWidth: 220,
  },
  searchInput: { ...font(type.body), color: c.text, flex: 1, paddingVertical: spacing.sm },
  status: { ...font(type.footnote, { tabular: true }), color: c.text2, padding: spacing.xs },
  listContent: { paddingVertical: spacing.sm, paddingBottom: spacing.huge },
  line: { flexDirection: 'row' as const, paddingHorizontal: spacing.sm, gap: spacing.sm },
  num: { fontFamily: MONO, fontSize: 11, lineHeight: 17, color: c.text3, textAlign: 'right' as const, width: 48 },
  // Long paths and class names break anywhere on the web, so no line goes past the edge.
  code: { fontFamily: MONO, fontSize: 12, lineHeight: 17, color: c.text, flex: 1, minWidth: 0, ...(Platform.OS === 'web' ? ({ wordBreak: 'break-all' } as object) : null) },
  footer: { padding: spacing.lg, gap: spacing.sm, alignItems: 'flex-start' as const },
  errorText: { ...font(type.footnote), color: c.danger },
}));
