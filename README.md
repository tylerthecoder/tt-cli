# tt-cli

A Bun CLI for listing, browsing, and syncing Tyler's Things notes.

## Setup

Install [Bun](https://bun.sh), then install the locked dependencies:

```bash
bun install --frozen-lockfile
bun run cli --help
```

To install the `tt` wrapper in `/usr/local/bin` (requires sudo):

```bash
bun run install.ts
```

The wrapper points to this checkout, so keep it at the same path after installing.

Commands load credentials from `~/.config/tt-cli/.env`, falling back to `.env`
in the current directory when that file cannot be loaded. Help and version
commands work without credentials.

Sync settings live in `~/.config/tt-cli/settings.json`. The directory and an
empty settings file are created when first needed. Set `notes_dir` before syncing;
both absolute paths and `~/` paths are supported:

```json
{
    "notes_dir": "~/Documents/Notes"
}
```

## Usage

```bash
tt notes list --tag research
tt notes list --published --format json
tt note view NOTE_ID
tt note open NOTE_ID
tt notes tui
```

Browser opening supports macOS and Linux. The TUI uses `j`/`k` or arrow keys to
navigate, `/` to search, `t` to filter tags, `o` to open in the browser, `v` to
view a note in `less`, `r` to refresh, and `q` to quit. Google Docs open in the
browser. Loading and opening errors appear in the TUI so you can retry.

`tt notes sync` is interactive and can modify local notes, Git history, and
remote records after its prompts. It is not a read-only validation command.

## Development

```bash
bun test
bun run lint
bun run format:check
bun run typecheck
bun audit
```

Tests use temporary homes and stubbed services/browser/pager processes. They do
not sync real notes or require credentials.

The pinned `@tt-services` source currently has type-only import errors under
`verbatimModuleSyntax`, so the full typecheck reports dependency errors. Keep
that check visible rather than suppressing it. The compatible dependency refresh
leaves one moderate `uuid` advisory in the Google API dependency chain; resolving
it requires a separately tested dependency upgrade. Live authenticated sync and
agent API compatibility are not exercised by this test suite.
