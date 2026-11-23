# Updater test fixtures

A throwaway key pair and a 64-byte "AppImage" (an ELF header and nothing else),
used by `tests/updater_install.rs` to prove the in-place updater end to end:
a local HTTP server publishes this manifest, the updater downloads the artifact,
verifies the signature against `test.key.pub` and writes it over the temp
"installed" file.

- `test.key.pub` — the public half of a **test-only** key. It is not the release
  key (that one lives in CI secrets and never in the repo).
- `app.AppImage` + `app.AppImage.sig` — payload and its minisign signature. The
  private key was thrown away after signing this file.

Never sign a real release with this key: nothing trusts it.