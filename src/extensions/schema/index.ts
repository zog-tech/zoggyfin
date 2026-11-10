/**
 * The extension manifest (schema versions 1 and 2). An extension is data
 * only: the app reads this file and draws its contributions. No code from an
 * extension runs in the app (App Store guideline 2.5.2). See
 * docs/extensions.md.
 *
 * `parseManifest` reads both versions and returns one internal model
 * (`normalize.ts`). The rest of the app imports from here only.
 */
import type { Manifest } from './normalize';
import type { Permission } from './common';

export {
  PERMISSIONS,
  PERMISSIONS_V1,
  SETTING_SOURCES,
  SHAPES,
  inputSchema,
  settingSchema,
  whenSchema,
  type HomeSectionSpec,
  type InputSpec,
  type ItemActionSpec,
  type PanelSpec,
  type Permission,
  type RequestSpec,
  type SettingField,
  type SettingSource,
  type Shape,
  type ShareTargetSpec,
  type When,
} from './common';
export { manifestSchemaV1, manifestSchemaV1 as manifestSchema, type ManifestV1 } from './v1';
export {
  LAYOUTS,
  MAX_PAGES,
  MAX_SECTIONS_PER_PAGE,
  MAX_SKIP_LABELS,
  MAX_TABS,
  MIN_TABS,
  SKIP_MODES,
  manifestSchemaV2,
  sectionSchema,
  tabSchema,
  type Layout,
  type ManifestV2,
  type PageInput,
  type PageSpec,
  type Placement,
  type SearchSpec,
  type SectionSpec,
  type SkipLabelSpec,
  type SkipMode,
  type TabSpec,
} from './v2';
export {
  SCHEMA_VERSION,
  SCHEMA_VERSIONS,
  homeRowKey,
  findPageSection,
  homeSectionsOfPages,
  pageFromHomeSection,
  pageSections,
  pagesOf,
  parseManifest,
  type Manifest,
  type ParseResult,
  type SchemaVersion,
} from './normalize';

/** Permissions in the words the install screen shows. */
export function describePermission(p: Permission, m: Pick<Manifest, 'name' | 'baseUrl'>): { title: string; detail: string; sensitive: boolean } {
  const host = safeHost(m.baseUrl);
  switch (p) {
    case 'network':
      return { title: `Connect to ${host}`, detail: `${m.name} receives the requests of its own buttons and rows. The app sends nothing to other addresses.`, sensitive: false };
    case 'itemPath':
      return { title: 'Read file paths', detail: `${m.name} receives the file path on the server of the items you use it on.`, sensitive: false };
    case 'jellyfinToken':
      return {
        title: `${m.name} can act as you on your Jellyfin server`,
        detail: `The app sends your sign-in token and the server address with each request to ${host}. With the token, ${m.name} can do all that you can do on the server. Allow this only for an extension that you trust.`,
        sensitive: true,
      };
    case 'playback':
      return { title: `Play media from ${host}`, detail: `The app plays video and audio from ${host} and tells ${m.name} how far you watched.`, sensitive: false };
    case 'downloads':
      return { title: `Save files from ${host}`, detail: `${m.name} can offer files that the app saves on this device.`, sensitive: false };
  }
}

export function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
