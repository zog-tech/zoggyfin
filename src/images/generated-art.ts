/**
 * Generated art: the last image fallback (design system §7.5). The gradient
 * comes from `fallbackArt()` in the theme, so the same title gives the same
 * art on every device and platform. This file adds the type glyph and title.
 */
import type { IconName } from '@/components/icon-names';
import { type FallbackArt, fallbackArt } from '@/theme/theme';

export interface GeneratedArt {
  art: FallbackArt;
  /** The type glyph (§7.5 step 9). */
  icon: IconName;
  /** The text to show on the tile. */
  title: string;
}

const ICONS: Record<string, IconName> = {
  Movie: 'film',
  Trailer: 'film',
  Video: 'play.rectangle',
  MusicVideo: 'play.rectangle',
  Series: 'tv',
  Season: 'tv',
  Episode: 'tv',
  MusicAlbum: 'music.note',
  Audio: 'music.note',
  AudioBook: 'waveform',
  Book: 'book',
  MusicArtist: 'music.mic',
  Person: 'person',
  Playlist: 'music.note.list',
  BoxSet: 'folder',
  MusicGenre: 'music.note',
  Genre: 'theatermasks',
  CollectionFolder: 'folder',
  UserView: 'folder',
  Folder: 'folder',
  Channel: 'antenna.radiowaves.left.and.right',
  TvChannel: 'antenna.radiowaves.left.and.right',
  LiveTvChannel: 'antenna.radiowaves.left.and.right',
};

const COLLECTION_ICONS: Record<string, IconName> = {
  movies: 'film',
  tvshows: 'tv',
  music: 'music.note',
  books: 'waveform',
  boxsets: 'folder',
  playlists: 'music.note.list',
  homevideos: 'play.rectangle',
  photos: 'photo',
  livetv: 'antenna.radiowaves.left.and.right',
  musicvideos: 'play.rectangle',
};

/**
 * A film or TV genre's glyph, from words in its name (English, as Jellyfin's metadata names them).
 * The first rule that matches wins, so "Action & Adventure" is Action. Others keep the masks.
 */
const GENRE_RULES: [RegExp, IconName][] = [
  [/action|martial/, 'flame'],
  [/comed|sitcom|stand.?up/, 'face.smiling'],
  [/horror/, 'moon.fill'],
  [/thrill|suspense/, 'eye'],
  [/crime|myster|detective|film.?noir/, 'magnifyingglass'],
  [/sci.?fi|science|space/, 'sparkles'],
  [/fantas|magic|fairy/, 'wand.and.stars'],
  [/anim|anime|cartoon/, 'paintpalette'],
  [/romanc|love/, 'heart'],
  [/famil|kids|child/, 'person.2'],
  [/adventure/, 'map'],
  [/\bwar\b|military/, 'shield'],
  [/western/, 'sun.max.fill'],
  [/sport/, 'trophy'],
  [/music|musical/, 'guitars'],
  [/documentar|reality|biograph|news/, 'camera'],
  [/histor/, 'book'],
  [/nature|travel|food/, 'leaf'],
  [/talk/, 'mic.fill'],
  [/foreign|world|international/, 'globe'],
];

/** A music genre's glyph: guitars for the guitar genres, the microphone for vocal ones, else a note. */
const MUSIC_GENRE_RULES: [RegExp, IconName][] = [
  [/rock|metal|punk|grunge|blues|country|folk|indie/, 'guitars'],
  [/hip.?hop|\brap\b|vocal|\br\s?&?\s?b\b|soul|gospel|nasheed/, 'music.mic'],
  [/classical|orchestr|soundtrack|score/, 'music.note.list'],
  [/podcast|spoken|talk|audiobook|quran/, 'waveform'],
];

function pick(rules: [RegExp, IconName][], name: string): IconName | null {
  const n = name.toLowerCase();
  for (const [re, icon] of rules) if (re.test(n)) return icon;
  return null;
}

/** The glyph for a genre tile: from its name, else the type glyph. Pure, so it is unit-tested. */
export function genreIcon(name: string | null | undefined, type: 'Genre' | 'MusicGenre'): IconName {
  const hit = pick(type === 'MusicGenre' ? MUSIC_GENRE_RULES : GENRE_RULES, name ?? '');
  return hit ?? ICONS[type];
}

export function iconForType(type?: string | null, collectionType?: string | null): IconName {
  if (collectionType && COLLECTION_ICONS[collectionType]) return COLLECTION_ICONS[collectionType];
  if (type && ICONS[type]) return ICONS[type];
  return 'play.rectangle';
}

export function generatedArt(
  title: string | null | undefined,
  type?: string | null,
  collectionType?: string | null,
  itemId = '',
): GeneratedArt {
  const text = (title ?? '').trim();
  return {
    art: fallbackArt(text, itemId),
    icon: type === 'Genre' || type === 'MusicGenre' ? genreIcon(text, type) : iconForType(type, collectionType),
    title: text || 'Untitled',
  };
}

/** Initials for a person or artist circle: the first letter of the first two words. */
export function initials(name: string | null | undefined): string {
  const firsts = (name ?? '')
    .trim()
    .split(/\s+/)
    .map((w) => Array.from(w).find((ch) => /[\p{L}\p{N}]/u.test(ch)))
    .filter((ch): ch is string => !!ch);
  return firsts.slice(0, 2).join('').toUpperCase();
}
