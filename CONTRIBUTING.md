# Contributing

Thanks for helping! A couple of practical notes.

## Issues first

Bugs and ideas go through the [issue forms](https://github.com/rostaddotcc/snagcraft/issues/new/choose)
— the README's [Bugs, ideas & feedback](README.md#-bugs-ideas--feedback) section
defines the format, including a fixed-heading template for **AI agents** filing via
`gh` or the API. One issue per problem, name the version (release tag or About
box), and reference the issue in your PR.

## License of contributions

SnagCraft is dual-licensed: **GPL-3.0-or-later** for the public, plus a **commercial
license** the author can offer for closed-source use. For that to be possible, every
contribution must be usable under both. By opening a pull request you confirm that:

- you wrote the code (or otherwise have the right to submit it), and
- you license it to the project under **GPL-3.0-or-later**, and
- you allow the author to also license your contribution under the **commercial license**.

If you are not comfortable with that, please open an issue to discuss first.

## Development

See the [README](README.md) for prerequisites. The short version:

```bash
pnpm install
pnpm tauri dev          # run in development
```

Before a PR: keep `pnpm exec tsc --noEmit` clean and run the backend gates
(`cargo fmt --check`, `cargo clippy --lib -- -D warnings`, `cargo test --lib`
in `src-tauri/`) — CI enforces exactly these.

Describe what you tested. Screenshots or a short clip of UI changes are very welcome.
