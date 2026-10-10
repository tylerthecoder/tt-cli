# tt-cli

A Bun CLI for listing, browsing, and syncing Tyler's Things notes.

## Setup

Install [Bun](https://bun.sh) 1.3.14 or newer:

```bash
bun install --frozen-lockfile
bun run cli --help
bun run install.ts
```

The installer writes a `tt` launcher to `/usr/local/bin` (requires sudo).
It points to this checkout, so keep the checkout at the same path.

The installed launcher passes `~/.config/tt-cli/.env` to Bun's `--env-file`.
For development, `bun run cli` uses Bun's normal local `.env` loading. Exported
variables take precedence; the application has no custom environment loader.

Set the notes directory in `~/.config/tt-cli/settings.json`:

```json
{
    "notes_dir": "~/Documents/Notes"
}
```

Settings reads never create or change files. Missing settings use defaults;
sync requires `notes_dir`. Absolute paths and `~/` paths are supported.

## Usage

```bash
tt notes list --tag research
tt notes list --published --format json
tt note view NOTE_ID
tt note open NOTE_ID
tt notes tui
```

Browser opening supports macOS and Linux. In the TUI: `j`/`k` navigate, `/`
searches, `t` filters tags, `o` opens the browser, `v` views a note in `less`,
`r` refreshes, and `q` quits. Loading and opening errors allow retry.

`tt notes sync` is interactive and can modify local notes, Git history, and
remote records after its prompts.

## Development

Bun handles file I/O, subprocesses, and environment loading. `gray-matter`
handles YAML frontmatter with its standard YAML semantics; application code
preserves Markdown bodies and prevents malformed frontmatter from becoming
new notes. Executable JavaScript frontmatter is disabled.

```bash
bun test
bun run lint
bun run format:check
bun run typecheck
bun audit
```

Tests use temporary homes and stubbed services/executables, not real notes or
credentials. Live sync and agent API calls are not covered.

Typechecking currently reports type-only import errors in the pinned
`tt-services` dependency. The dependency audit reports two moderate advisories:
`uuid` in the Google API chain and `sprintf-js` through `gray-matter`.
