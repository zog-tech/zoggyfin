/**
 * The page of one extension entry (the route of an entry with `detail`). It
 * loads the detail description (`GET entry.detail`, through the extension
 * HTTP layer: origin lock, the manifest's headers, 8 s) and shows it with
 * `PlainDetail`: pictures, eyebrow, title, lines, the description, Play or
 * Resume, Start over, Download, the extension's buttons, then the detail's
 * sections (a row by default; a last grid or list scrolls with the page).
 *
 * Rules:
 * - The route params are checked again: a detail URL that is not on the
 *   extension's origin shows "This entry cannot be opened".
 * - Loading shows a skeleton; a failure shows a message with no URL and
 *   "Try again".
 * - Play checks the `playback` grant (`openMedia`); Download shows only with
 *   the `downloads` grant on a platform that saves files.
 * - An on/off button shows its new state at once and goes back when the
 *   request fails; a late reply to an older press never wins
 *   (`detail-view.ts`). The reply's `refresh`: `entry` loads this page
 *   again, `page` the extension's feeds, `library` the app's data.
 * - TV: Play takes the first focus (else the first button); the D-pad goes
 *   Play, the buttons, then the sections.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { View } from 'react-native';

import { useApi } from '@/api/use-api';
import { RowHeader } from '@/components/item-row';
import { Delayed, SkeletonBlock } from '@/components/skeleton';
import { EmptyState } from '@/components/states';
import { type DetailDescription, entryDetailKey, extensionFeedsKey, fetchDetail } from '@/extensions/feeds';
import { buildRequest } from '@/extensions/http';
import { safeText } from '@/extensions/media/source';
import { currentAccount, runDetailAction, templateContext } from '@/extensions/runtime';
import { getExtension, type InstalledExtension, useExtensions } from '@/extensions/store';
import { useFeedSection } from '@/extensions/ui/use-feed';
import { PlainDetail, PlainDetailHeader, type PlainAction } from '@/features/detail/plain-detail';
import { createKeyedGate } from '@/lib/async-gate';
import { features } from '@/platform/tv';
import { createStyles, type AppTheme, radius, scaled, spacing, useLayout, useStyles } from '@/theme';

import { canDownload, type DetailButton, detailPlayable, detailView, dropSettled, pressToggle, settleToggle, type ToggleMap, withActionState } from './detail-view';
import { downloadMedia } from './download-entry';
import { openMedia } from './open-entry';
import { type EntryRoute, parseEntryRoute } from './routes';
import { InfiniteEntries, SectionBlock } from './sections';
import { sectionMode } from './section-view';

type Param = string | string[] | undefined;

export function EntryScreen({ params }: { params: { ext?: Param; entry?: Param; detail?: Param; title?: Param } }) {
  const ext = useExtensions((st) => st.list.find((e) => e.manifest.id === (Array.isArray(params.ext) ? params.ext[0] : params.ext)));
  const route = parseEntryRoute(params, ext?.manifest.baseUrl);
  if (!ext) {
    return (
      <>
        <Stack.Screen options={{ title: '' }} />
        <EmptyState icon="square.grid.2x2" title="This extension is not installed" message="Add it again in Settings, Extensions." />
      </>
    );
  }
  if (!ext.enabled) {
    return (
      <>
        <Stack.Screen options={{ title: '' }} />
        <EmptyState icon="square.grid.2x2" title={`${ext.manifest.name} is turned off`} message="Turn it on in Settings, Extensions." />
      </>
    );
  }
  if (!route) {
    return (
      <>
        <Stack.Screen options={{ title: '' }} />
        <EmptyState icon="square.grid.2x2" title="This entry cannot be opened" message={`${ext.manifest.name} sent a link the app does not open.`} />
      </>
    );
  }
  return <EntryDetail ext={ext} route={route} />;
}

function EntryDetail({ ext, route }: { ext: InstalledExtension; route: EntryRoute }) {
  const { scope } = useApi();
  const qc = useQueryClient();
  const extId = ext.manifest.id;
  const key = entryDetailKey(scope, extId, route.detail);
  const q = useQuery({
    queryKey: key,
    retry: 1,
    queryFn: () => {
      const cur = getExtension(extId) ?? ext;
      return fetchDetail(() => buildRequest(cur.manifest, { method: 'GET', path: route.detail }, templateContext(cur), cur.grants, currentAccount()), cur.manifest.baseUrl);
    },
  });

  // On/off buttons (detail-view.ts). Tokens come from a keyed gate, one key per action.
  const [toggles, setToggles] = useState<ToggleMap>({});
  const [gate] = useState(() => createKeyedGate<string>());
  useEffect(() => () => gate.cancelAll(), [gate]);
  // A fresh detail is the truth for every button with no running request.
  // (Adjusted during render, the React pattern for state that follows a changed value.)
  const [seenAt, setSeenAt] = useState(q.dataUpdatedAt);
  if (seenAt !== q.dataUpdatedAt) {
    setSeenAt(q.dataUpdatedAt);
    setToggles((m) => dropSettled(m));
  }
  // A double tap on a button with no state runs its request once.
  const running = useRef(new Set<string>());

  const refreshEntry = useCallback(() => void qc.invalidateQueries({ queryKey: key }), [qc, key]);
  const refreshPage = useCallback(() => void qc.invalidateQueries({ queryKey: extensionFeedsKey(scope, extId) }), [qc, scope, extId]);

  const press = useCallback(
    async (d: DetailDescription, b: DetailButton) => {
      const cur = getExtension(extId) ?? ext;
      if (b.key === 'start-over' && !b.action) return openMedia(cur, detailPlayable(d), { startSeconds: 0 });
      if (b.key === 'download' && !b.action) return downloadMedia(cur, d);
      const action = b.action;
      if (!action) return;
      if (!action.state || b.next === undefined) {
        if (running.current.has(action.id)) return;
        running.current.add(action.id);
        try {
          await runDetailAction(cur, action, { refreshEntry, refreshPage });
        } finally {
          running.current.delete(action.id);
        }
        return;
      }
      const next = b.next;
      let token = -1;
      const out = await runDetailAction(cur, action, {
        next,
        refreshEntry,
        refreshPage,
        onSend: () => {
          token = gate.begin(action.id);
          setToggles((m) => pressToggle(m, action, next, token));
        },
      });
      // Cancelled in a prompt: the button never changed.
      if (token < 0) return;
      setToggles((m) => settleToggle(m, action.id, token, next, out.status === 'done' ? { ok: true, on: out.reply?.state?.on } : { ok: false }));
      // The cached detail keeps the confirmed state, so a reload shows it too. Only the newest press writes it.
      if (out.status === 'done' && gate.current(action.id, token)) {
        const on = out.reply?.state?.on ?? next;
        qc.setQueryData<DetailDescription>(key, (old) => (old ? withActionState(old, action.id, on) : old));
      }
    },
    [extId, ext, gate, refreshEntry, refreshPage, qc, key],
  );

  if (!q.data) {
    if (q.error && !q.isFetching) {
      return (
        <>
          <Stack.Screen options={{ title: route.title ?? '' }} />
          <EmptyState
            icon="exclamationmark.triangle"
            title="This entry did not load"
            message={safeText(q.error, `${ext.manifest.name} did not answer.`)}
            action={{ title: 'Try again', onPress: () => void q.refetch() }}
          />
        </>
      );
    }
    return <DetailSkeleton title={route.title} />;
  }
  return <DetailBody ext={ext} detail={q.data} toggles={toggles} onPress={press} />;
}

function DetailBody({
  ext,
  detail,
  toggles,
  onPress,
}: {
  ext: InstalledExtension;
  detail: DetailDescription;
  toggles: ToggleMap;
  onPress: (d: DetailDescription, b: DetailButton) => void;
}) {
  const extId = ext.manifest.id;
  const view = detailView(detail, toggles, { canDownload: canDownload(ext, features.downloads) });
  const sections = view.sections;
  const last = sections.length - 1;
  const lastInfinite = last >= 0 && sectionMode(sections, last) === 'infinite';
  const lastSection = lastInfinite ? sections[last] : undefined;
  const lastFeed = useFeedSection(lastSection ? { extId, feed: lastSection.feed, refreshSeconds: lastSection.refreshSeconds } : undefined, { paged: true, enabled: !!lastSection });

  const actions: PlainAction[] = view.buttons.map((b) => ({ key: b.key, icon: b.icon, label: b.label, active: b.active, onPress: () => onPress(detail, b) }));
  const header = {
    kind: view.kind,
    id: detail.media?.id ?? view.title,
    title: view.title,
    eyebrow: view.eyebrow,
    poster: view.poster,
    backdrop: view.backdrop,
    lines: view.lines,
    overview: view.description,
    actions,
    primary: view.primary
      ? { label: view.primary.label, progress: view.primary.progress, onPress: () => void openMedia(getExtension(extId) ?? ext, detailPlayable(detail)) }
      : null,
  };

  // Rows and previews. A preview has no "See all": a detail's sections are not pages of the manifest.
  const blocks: ReactNode[] = sections.map((sec, i) => {
    const mode = sectionMode(sections, i);
    if (mode === 'infinite') return null;
    return <SectionBlock key={sec.id} extId={extId} extensionName={ext.manifest.name} section={sec} mode={mode} where="page" />;
  });

  if (lastSection && (lastSection.layout === 'grid' || lastSection.layout === 'list')) {
    return (
      <>
        <Stack.Screen options={{ title: '' }} />
        <InfiniteEntries
          extId={extId}
          extensionName={ext.manifest.name}
          feed={lastFeed}
          layout={lastSection.layout}
          shape={lastSection.shape}
          header={
            <View>
              <PlainDetailHeader {...header} />
              {blocks}
              <RowHeader title={lastSection.title} />
            </View>
          }
          empty="Nothing here yet."
          focusFirst={false}
        />
      </>
    );
  }
  return <PlainDetail {...header}>{blocks}</PlainDetail>;
}

/** Loading: the backdrop, the title and the lines as quiet blocks. */
function DetailSkeleton({ title }: { title?: string }) {
  const s = useStyles(makeStyles);
  const l = useLayout();
  const heroH = Math.round(Math.min(l.height * 0.42, l.contentWidth * 0.6));
  return (
    <View style={s.page} accessibilityLabel="Loading" accessibilityRole="progressbar">
      <Stack.Screen options={{ title: title ?? '' }} />
      <Delayed>
        <SkeletonBlock width="100%" height={heroH} />
        <View style={[s.lines, { paddingHorizontal: l.gutter }]}>
          <SkeletonBlock width={Math.min(l.contentWidth * 0.6, scaled(320))} height={scaled(28)} radius={radius.sm} />
          <SkeletonBlock width={Math.min(l.contentWidth * 0.4, scaled(200))} height={scaled(14)} radius={radius.sm} />
          <SkeletonBlock width={scaled(200)} height={scaled(44)} radius={radius.pill} />
        </View>
      </Delayed>
    </View>
  );
}

const makeStyles = createStyles(({ c }: AppTheme) => ({
  page: { flex: 1, backgroundColor: c.bg },
  lines: { gap: spacing.md, marginTop: spacing.lg },
}));
