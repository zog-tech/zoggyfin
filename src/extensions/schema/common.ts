/**
 * The manifest parts that schema version 1 and schema version 2 share:
 * ids, settings, requests, inputs and the v1 contributions. Pure, so it is
 * unit-tested through `parseManifest`.
 */
import { z } from 'zod';

export const id = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9._-]*$/, 'Use lower-case letters, digits, ".", "_" and "-"');
/** A setting or input key, as used in templates (`{{settings.apiKey}}`). */
export const keyName = z
  .string()
  .min(1)
  .max(40)
  .regex(/^[a-zA-Z][a-zA-Z0-9_]*$/, 'Use letters, digits and "_", starting with a letter');
export const label = z.string().min(1).max(80);
export const text = z.string().max(500);
/** A path under `baseUrl` ("/api/x") or a full URL on the same origin. */
export const path = z.string().min(1).max(500);

/** The permissions of schema version 1. */
export const PERMISSIONS_V1 = ['network', 'itemPath', 'jellyfinToken'] as const;
/** Every permission. Schema version 2 adds `playback` and `downloads`. */
export const PERMISSIONS = [...PERMISSIONS_V1, 'playback', 'downloads'] as const;
export type Permission = (typeof PERMISSIONS)[number];

/**
 * Values the app fills in by itself, so an install needs no typing. The
 * user can still change a filled value.
 */
export const SETTING_SOURCES = ['jellyfin.serverUrl', 'jellyfin.serverId', 'jellyfin.userId', 'jellyfin.userName', 'jellyfin.isAdmin'] as const;
export type SettingSource = (typeof SETTING_SOURCES)[number];

const settingBase = { key: keyName, label, description: text.optional() };
export const settingSchema = z.discriminatedUnion('type', [
  z.object({
    ...settingBase,
    type: z.literal('text'),
    secret: z.boolean().optional(),
    placeholder: text.optional(),
    default: z.string().max(500).optional(),
    source: z.enum(SETTING_SOURCES).optional(),
  }),
  z.object({ ...settingBase, type: z.literal('toggle'), default: z.boolean().optional(), source: z.literal('jellyfin.isAdmin').optional() }),
  z.object({
    ...settingBase,
    type: z.literal('choice'),
    options: z.array(z.object({ value: z.string().max(200), label })).max(100).optional(),
    /** An endpoint that returns the options. The app fetches it at install and when the settings open. */
    optionsSource: path.optional(),
    /** Pick the first option whose value or label matches a Jellyfin library name (without case). */
    matchLibrary: z.boolean().optional(),
    default: z.string().max(200).optional(),
  }),
]);
export type SettingField = z.infer<typeof settingSchema>;

export const requestSchema = z.object({
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).default('POST'),
  path,
  /** Query values. Each string is a template. */
  query: z.record(z.string(), z.string().max(500)).optional(),
  /** A JSON body. Each string value is a template. */
  body: z.record(z.string(), z.unknown()).optional(),
});
export type RequestSpec = z.infer<typeof requestSchema>;

const inputBase = { key: keyName, title: label, message: text.optional() };
export const inputSchema = z.discriminatedUnion('type', [
  z.object({ ...inputBase, type: z.literal('text'), placeholder: text.optional(), default: z.string().max(500).optional() }),
  z.object({
    ...inputBase,
    type: z.literal('choice'),
    /** Fixed options, or `source`: an endpoint that returns them. */
    options: z.array(z.object({ value: z.string().max(200), label })).max(100).optional(),
    source: path.optional(),
    default: z.string().max(200).optional(),
  }),
]);
export type InputSpec = z.infer<typeof inputSchema>;

export const confirmSchema = z.object({ title: label, message: text.optional(), action: z.string().min(1).max(40).default('Continue') });

/** Which items an action shows on. Every given field must match; an empty filter matches all items. */
export const whenSchema = z.object({
  types: z.array(z.string().max(40)).max(30).optional(),
  mediaTypes: z.array(z.string().max(40)).max(10).optional(),
  /** Library (collection folder) names, compared without case. */
  libraries: z.array(z.string().max(120)).max(30).optional(),
  /** Item file path prefixes. Needs the `itemPath` permission. */
  pathPrefixes: z.array(z.string().max(300)).max(30).optional(),
});
export type When = z.infer<typeof whenSchema>;

export const itemActionSchema = z.object({
  id,
  title: label,
  icon: z.string().max(60).optional(),
  destructive: z.boolean().optional(),
  when: whenSchema.optional(),
  confirm: confirmSchema.optional(),
  inputs: z.array(inputSchema).max(5).optional(),
  request: requestSchema,
});
export type ItemActionSpec = z.infer<typeof itemActionSchema>;

export const SHAPES = ['poster', 'thumb', 'square'] as const;
export type Shape = (typeof SHAPES)[number];

export const homeSectionSchema = z.object({
  id,
  title: label,
  /** A JSON feed: `{ "items": [...] }` (see docs/extensions.md). */
  feed: path,
  /** Fetch the feed again after this many seconds (5 or more). */
  refreshSeconds: z.number().int().min(5).max(3600).optional(),
  shape: z.enum(SHAPES).default('thumb'),
});
export type HomeSectionSpec = z.infer<typeof homeSectionSchema>;

export const shareTargetSchema = z.object({
  id,
  title: label,
  /** Host names the link must have ("youtube.com" also matches "www.youtube.com"). Empty: any http(s) link. */
  hosts: z.array(z.string().max(120)).max(50).optional(),
  inputs: z.array(inputSchema).max(5).optional(),
  request: requestSchema,
});
export type ShareTargetSpec = z.infer<typeof shareTargetSchema>;

export const panelSchema = z.object({
  id,
  title: label,
  icon: z.string().max(60).optional(),
  /** A page under `baseUrl`. It is a template, so it can carry `{{settings.x}}` in the fragment. */
  url: path,
});
export type PanelSpec = z.infer<typeof panelSchema>;

/**
 * The manifest fields outside `contributes`, except `schemaVersion` and
 * `permissions` (each version has its own list). The order matters: the
 * error names the first wrong field.
 */
export const headFields = {
  id,
  name: label,
  version: z.string().min(1).max(40),
  description: text.optional(),
  /** Every request goes to this origin and to no other. */
  baseUrl: z
    .url()
    .refine((u) => /^https?:\/\//i.test(u), 'The base URL must use http or https'),
  icon: z.string().max(60).optional(),
};

/** Headers sent with every request. Values are templates (for example `Bearer {{settings.apiKey}}`). */
export const headersSchema = z.record(z.string(), z.string().max(500)).optional();

/** The v1 contribution lists. Schema version 2 keeps all of them except `homeSections`. */
export const v1Contributions = {
  settings: z.array(settingSchema).max(20).optional(),
  itemActions: z.array(itemActionSchema).max(20).optional(),
  homeSections: z.array(homeSectionSchema).max(5).optional(),
  shareTargets: z.array(shareTargetSchema).max(10).optional(),
  panels: z.array(panelSchema).max(5).optional(),
};
