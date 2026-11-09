---
name: add-item-action
description: Add a built-in item action (an entry in an item's action sheet) or a built-in Home section (a row on Home) to Zoggyfin through the registries in src/registry. Use when asked to add a menu action for movies, episodes, albums or playlists, or a new row on the Home screen.
---

# Add an item action or a Home section

Built-ins and extensions use the same registries (`src/registry/`). Never add an action or a Home row by editing a screen directly.

## Item action

Files:

- `src/registry/item-actions.ts`: the `ItemAction` and `AppActionApi` types, `createRegistry`, `actionsFor`.
- `src/features/actions/builtin.ts`: the built-in actions.
- `src/features/actions/use-item-actions.ts`: supplies `AppActionApi` (the app side of each action).
- `src/components/icon-names.ts` and `src/components/icon.web.tsx`: icon names.

Steps:

1. **Pick an icon.** Use an SF Symbol name that is a key of `ANDROID_SYMBOLS` in `icon-names.ts`. For a new name, add it to `ANDROID_SYMBOLS` (the Material Symbol for Android) and to `LUCIDE` in `icon.web.tsx` (the Lucide icon for web). `IconName` is typed, so `pnpm typecheck` finds a missing entry.
2. **Add the app capability, if the action needs one.** Add an optional method to `AppActionApi` (optional, so a host without it hides the action). Implement it in `use-item-actions.ts`:
   - Call the server through `@/api/jellyfin` (add a wrapper there if it is missing), never the SDK directly.
   - Wrap with the local `guard()` for a toast and a cache refresh, or call `qc.invalidateQueries` with a key from `@/api/query-keys`.
   - Confirm destructive actions with `confirmDestructive()` from `@/lib/confirm`.
3. **Register the action** in `registerBuiltinItemActions()` in `builtin.ts`:

   ```ts
   itemActions.register({
     id: 'builtin.myAction',            // ids are unique; the same id replaces an entry
     title: 'My action',                // plain English, sentence case
     icon: 'star',
     order: 30,                          // lower comes first; built-ins use steps of 10
     group: 'library',                   // sheet section: play, library, goTo or more (default)
     destructive: false,                 // true shows it in red, near the end (orders 90+)
     when: ({ item, app }) => !!app.myAction && item.Type === 'Movie',
     run: ({ item, app }) => app.myAction?.(item),
   });
   ```

   - `when` must be cheap and must not throw. A throwing `when` hides the action.
   - Check the capability (`!!app.x`) in `when`, so platforms without it (web and TV have no downloads) hide the action.
   - Use `titleFor` for a title that depends on state ("Downloading 45%").
   - Check `item.CanDelete` or other server permissions where they apply.
4. **Platforms.** Check `features` in `src/platform/tv.ts`. Hide the action where the feature does not exist, or show a clear message.
5. **Test.** Put pure filter logic in a pure function and test it. For registry behaviour, follow `src/registry/__tests__/registry.test.ts` (it calls `actionsFor` with a fake `app`).
6. **Check.** Run `pnpm typecheck`, `pnpm lint`, `pnpm jest src/registry src/extensions`. Open the action sheet on a movie, an episode, an album and a playlist on the demo server.

## Home section

Files:

- `src/registry/home-sections.ts`: the `HomeSection` type (`id`, `order`, `component`).
- `src/features/home/builtin-sections.tsx`: the built-in rows and `registerBuiltinHomeSections()`.
- `src/app/(tabs)/(home)/index.tsx`: renders the registered sections in order.

Steps:

1. Write the section as a component in `builtin-sections.tsx` (or a file in `src/features/<feature>/` for a big one). Get data with a query hook from `@/api/queries` (add one with a key in `query-keys.ts` if needed). The key must start with the session scope: Home's pull to refresh invalidates `queryKeys.all(scope)`, so a scoped key refreshes with it.
2. The component **hides itself** (returns `null`) when it has nothing to show. It must not block Home when its request fails.
3. Use the shared row and tile components and theme tokens, like the other rows in the file.
4. Register it in `registerBuiltinHomeSections()`:

   ```ts
   homeSections.register({ id: 'builtin.myRow', order: 35, component: MyRow });
   ```

   Current orders: downloaded (offline) 5, Continue Watching 10, Next Up 20, Continue Listening 30, Recently Added 40, extension rows from 45, downloaded 50.
5. Offline: decide what the row shows with no server (`useOffline()` from `@/lib/online`). Most rows hide.
6. Check Home on a phone, iPad width, the web, the TV layout (web `?tv=1`), light and dark, and with "Simulate no server".

## Extensions

Extensions add actions and rows from a JSON manifest through `src/extensions/runtime.ts` (ids `ext.<extensionId>.<name>`). To change what extensions can do, update `src/extensions/schema.ts`, its tests and `docs/extensions.md` together.
