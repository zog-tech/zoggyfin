## What changed

<!-- One or two sentences. Say why you made the change. -->

## Related issue

<!-- For example: Fixes #123 -->

## Platforms

Every feature must work on every platform. Tick what you tested.

- [ ] iPhone
- [ ] iPad
- [ ] Android
- [ ] Web
- [ ] Mac app
- [ ] TV (Android TV, Fire TV, or the web with `?tv=1`)
- [ ] Not a platform change (docs, tests or tooling)

If a platform is not done, say which one and why:

If the change is in platform code, did the other platforms need it too? Say what you ported, or why it applies to one platform only (see "Port each change to the other platforms" in [AGENTS.md](../AGENTS.md)):

## How I tested it

<!-- Steps, devices and the Jellyfin server version. -->

## Checklist

- [ ] `pnpm typecheck`, `pnpm lint` and `pnpm test` pass
- [ ] For a change in `desktop/`: `cargo fmt --check` and `cargo clippy --all-targets -- -D warnings` pass
- [ ] I added or updated tests
- [ ] I updated the docs and the README when the app does something new
- [ ] The commit messages follow the style in [CONTRIBUTING.md](../CONTRIBUTING.md)
- [ ] The change has no secrets, private server addresses or personal data
- [ ] Screenshots, if any, use the public Jellyfin demo server only
