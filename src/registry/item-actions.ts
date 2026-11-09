/**
 * The item action registry. An item's action sheet lists every registered
 * action whose `when` accepts the item. Built-in actions register here the
 * same way any later contributor (for example an extension) will.
 */
import type { BaseItemDto } from '@/api/types';
import type { IconName } from '@/components/icon-names';
import type { DownloadStatus } from '@/downloads/types';

/** What an action may ask the app to do. The screen that shows the sheet supplies it. */
export interface AppActionApi {
  play(item: BaseItemDto): void;
  openItem(item: BaseItemDto): void;
  setFavorite(item: BaseItemDto, favorite: boolean): Promise<void>;
  setPlayed(item: BaseItemDto, played: boolean): Promise<void>;
  /** Audio queue. Optional, so a host without a player can leave them out. */
  playNext?(item: BaseItemDto): void;
  addToQueue?(item: BaseItemDto): void;
  instantMix?(item: BaseItemDto): void;
  /** Playlists. */
  addToPlaylist?(item: BaseItemDto): void;
  renamePlaylist?(item: BaseItemDto): void;
  deletePlaylist?(item: BaseItemDto): void | Promise<void>;
  /** Deletes the item and its files from the server. */
  deleteItem?(item: BaseItemDto): void | Promise<void>;
  /** Downloads. Left out where downloads do not exist (web, TV). */
  downloadStatus?(item: BaseItemDto): DownloadStatus;
  download?(item: BaseItemDto): void;
  removeDownload?(item: BaseItemDto): void | Promise<void>;
  openDownloads?(): void;
  /** Remote control: start the item on another device of this account. Left out on TV. */
  playOn?(item: BaseItemDto): void;
}

export interface ItemActionContext {
  item: BaseItemDto;
  app: AppActionApi;
  /** Platform the app runs on, for actions that only make sense on some. */
  platform: 'ios' | 'android' | 'web' | string;
  /**
   * Facts that need an extra request (the item's library and file path).
   * The sheet loads them only when a registered action asks for them.
   */
  facts?: { libraryName?: string | null; path?: string | null };
  /**
   * The Id of the item page on screen, when the sheet opens over one. An
   * action that would open that same page ("Go to album" on the album) hides.
   */
  here?: string | null;
}

/**
 * The section of the action sheet an action shows in. The sheet shows the
 * sections in this order, each as its own group; destructive actions go to
 * a last group whatever their section.
 */
export type ItemActionGroup = 'play' | 'library' | 'goTo' | 'more';

export const ITEM_ACTION_GROUPS: readonly ItemActionGroup[] = ['play', 'library', 'goTo', 'more'];

export interface ItemAction {
  id: string;
  title: string;
  /** A title that depends on the item or its state ("Downloading 45%"). */
  titleFor?: (ctx: ItemActionContext) => string;
  /** An icon name (see components/icon-names.ts). */
  icon: IconName;
  /** Lower comes first. Built-ins use steps of 10. */
  order?: number;
  destructive?: boolean;
  /** The sheet section. Left out (as for extension actions), the action goes to `more`. */
  group?: ItemActionGroup;
  when?: (ctx: ItemActionContext) => boolean;
  run: (ctx: ItemActionContext) => void | Promise<void>;
}

export interface Registry<T extends { id: string }> {
  register(entry: T): () => void;
  list(): readonly T[];
  subscribe(listener: () => void): () => void;
}

/** A small ordered registry. Registering an existing id replaces it. */
export function createRegistry<T extends { id: string; order?: number }>(): Registry<T> {
  let entries: T[] = [];
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((l) => l());
  return {
    register(entry) {
      entries = [...entries.filter((e) => e.id !== entry.id), entry].sort(
        (a, b) => (a.order ?? 100) - (b.order ?? 100),
      );
      emit();
      return () => {
        entries = entries.filter((e) => e !== entry);
        emit();
      };
    },
    list: () => entries,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export const itemActions = createRegistry<ItemAction>();

/** The title to show for an action in this context. */
export function actionTitle(action: ItemAction, ctx: ItemActionContext): string {
  try {
    return action.titleFor ? action.titleFor(ctx) : action.title;
  } catch {
    return action.title;
  }
}

export function actionsFor(ctx: ItemActionContext, registry: Registry<ItemAction> = itemActions): ItemAction[] {
  return registry.list().filter((a) => {
    try {
      return a.when ? a.when(ctx) : true;
    } catch {
      // A broken filter hides its action; it never breaks the sheet.
      return false;
    }
  });
}

export interface ActionSection {
  key: ItemActionGroup | 'destructive';
  actions: ItemAction[];
}

/**
 * Splits the sheet's actions into its sections: play and queue, library
 * (favourite, playlist, download, played), go to, more, then the
 * destructive ones. Empty sections are left out; the registry order holds
 * inside a section. An unknown group counts as `more`. Pure, so it is
 * unit-tested.
 */
export function actionSections(actions: readonly ItemAction[]): ActionSection[] {
  const buckets = new Map<ActionSection['key'], ItemAction[]>();
  for (const a of actions) {
    const key: ActionSection['key'] = a.destructive ? 'destructive' : a.group && ITEM_ACTION_GROUPS.includes(a.group) ? a.group : 'more';
    buckets.set(key, [...(buckets.get(key) ?? []), a]);
  }
  return [...ITEM_ACTION_GROUPS, 'destructive' as const]
    .map((key) => ({ key, actions: buckets.get(key) ?? [] }))
    .filter((sec) => sec.actions.length > 0);
}
