# tt-cli

A Bun-native CLI for listing, browsing, and syncing Tyler's Things notes.

## Setup

Install [Bun](https://bun.sh) 1.3.14 or newer, then install the locked dependencies:

```bash
bun install --frozen-lockfile
bun run cli --help
```

To install the `tt` wrapper in `/usr/local/bin` (requires sudo):

```bash
bun run install.ts
```

The wrapper points to this checkout, so keep it at the same path after installing.

Bun loads local `.env` files at startup. Commands also load defaults from
`~/.config/tt-cli/.env` using Bun's native environment parser, falling back to
`.env` in the current directory if the home file is absent. Exported variables
and values already loaded by Bun take precedence. Unreadable config files produce
an error. Help and version commands work without credentials.

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

## Bun-native implementation

File contents, JSON settings, and caches use `Bun.file()` and `Bun.write()`;
browser and pager processes use `Bun.spawn()`. Note frontmatter uses
`Bun.YAML.parse()` and `Bun.YAML.stringify()` with compatibility handling for
Date values and undefined metadata. Frontmatter must use an unindented root block
mapping with unique, one-line scalar keys (plain or quoted). Root flow maps,
explicit/complex/multiline keys, and root merge keys are rejected so duplicate
note IDs cannot be silently selected by the parser. Nested mappings, sequences,
anchors, and merge keys are supported. Invalid frontmatter is never uploaded as
a new note. Timestamps parse as strings, matching the note service's schema.
Directory operations and exclusive private config creation use Bun's built-in
Node-compatible filesystem APIs where needed.

There are no direct `js-yaml`, `dotenv`, `react-devtools-core`, or `bun-pty`
dependencies. Some still appear transitively through tooling or `tt-services`.
The interactive prompt, command parser, and TUI libraries remain in use.

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
