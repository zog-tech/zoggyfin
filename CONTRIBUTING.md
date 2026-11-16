# Contributing to Zoggyfin

Thank you for your interest. This guide tells you how to set up the project, check your work and send a change.

By taking part, you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).
To report a security problem, do not open an issue. Follow [SECURITY.md](SECURITY.md).

## Before you start

- Look for an existing issue or discussion first.
- For a big change, open an issue or a discussion before you write code. This saves you time.
- Small fixes (a bug, a typo, a missing test) can go straight to a pull request.

## One rule: every platform gets each feature

Zoggyfin runs on iPhone, iPad, Android, the web and the Mac app. A feature must work on all of them.

- Build the feature for every platform in the same pull request, or say in the pull request which
  platform is not done yet and why.
- If a platform cannot support the feature, say so in the pull request, and show a clear message in the app.
  Do not let the feature fail without a word.
- Use the shared code in `src/` first. Put code for one platform in a file with a platform suffix
  (for example `.web.tsx` or `.ios.ts`) or in `modules/` or `desktop/`.
- The same applies to fixes and improvements. When you change platform code, check whether the other
  platforms need the same change, and port it. [AGENTS.md](AGENTS.md) (section 3a) lists where each
  platform keeps its version of the code.
- Update the README and the docs when the feature changes what the app does.

## Setup

You need:

- Node 22 or later
- pnpm 10
- Xcode, for iOS builds
- Rust (stable) and Homebrew `mpv`, for the Mac app

```sh
pnpm install
pnpm expo run:ios        # builds the native app and starts it in the simulator
pnpm start               # starts Metro for an already installed development build
pnpm expo start --web    # runs the web app in a browser
```

The `ios/` and `android/` folders are generated (Expo CNG) and are not in git.
Use `pnpm`, not `npm` or `yarn`.

You need a Jellyfin server to try the app. The public demo server is
`https://demo.jellyfin.org/stable`, with user name `demo` and no password.

## Scripts

| Script | What it does |
|---|---|
| `pnpm start` | Starts Metro for a development build |
| `pnpm ios` | Builds and runs the iOS app (`expo run:ios`) |
| `pnpm typecheck` | Type check with `tsc --noEmit` |
| `pnpm lint` | Lint with `expo lint` |
| `pnpm test` | Unit tests with jest |
| `pnpm test:crypto-swift` | Checks the Swift rendezvous crypto against the shared test vectors |
| `pnpm desktop:dev` | Runs the Mac app in development (needs Metro web on port 8082) |
| `pnpm desktop:build` | Builds the Mac app for testing, not signed |

`desktop:release`, `desktop:publish`, `desktop:version`, `tv:release` and `site:deploy` are for the maintainer.
They need signing keys and deploy tokens.

## Code style

- TypeScript with `strict` on. Do not use `any` (the lint rule is an error).
- The lint rules come from `eslint-config-expo`. Fix every lint warning that your change adds.
- Follow the code around you: file names, folder layout and naming.
- Use the design tokens from `src/theme/` and the rules in [docs/design](docs/design/).
  Do not hard-code colors or sizes.
- Write comments that explain why the code does something. Do not describe what the code says.
- Rust code uses `rustfmt` with `max_width = 120` (see `desktop/src-tauri/rustfmt.toml`).
- Write docs and user-facing text in plain English: short sentences, active voice.
- Do not add a new dependency without a reason. Say why in the pull request.

## Tests and checks

Run these before you push. CI runs the same checks.

```sh
pnpm typecheck
pnpm lint
pnpm test
```

If you change `desktop/`, also run:

```sh
cd desktop/src-tauri
cargo fmt --check
cargo clippy --all-targets -- -D warnings
```

Rust checks need macOS and Homebrew `mpv`.

Add or update a test when you fix a bug or add logic. Tests live in `__tests__/` folders next to the code.
For a change to the screens, run the app and try it on the platforms you changed.

## Commit style

Look at `git log` for the style.

- The first line is one short sentence in the imperative mood: "Add invites", "Fix the search top result markup".
- Start with a capital letter. Do not end with a period. Do not use a type prefix like `feat:`.
  A platform prefix is fine when the change is for one platform only ("Android: seek in video downloads").
- Keep the first line under about 72 characters.
- Leave a blank line, then explain why you made the change and what it does. Wrap lines at about 72 characters.
- Make small commits. One commit does one thing.

## Pull request flow

1. Fork the repository and make a branch from `main`.
2. Make your change and run the checks above.
3. Push your branch and open a pull request against `main`. Fill in the pull request template.
4. CI must pass. A maintainer reviews your pull request and may ask for changes.
5. Answer the comments and push more commits to the same branch.
6. A maintainer merges the pull request. The branch is deleted after the merge.

Keep a pull request small and about one thing. Describe how you tested it.
Do not include secrets, personal data, private server addresses or screenshots of a private server.
Use the public Jellyfin demo server for screenshots.

## License

When you contribute code, you agree that it is under the [Mozilla Public License 2.0](LICENSE).
Do not copy code from a project with an incompatible license. Do not copy GPL code into this repository.
