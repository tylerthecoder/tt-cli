// Run only in an isolated subprocess: module mocks must not leak into other tests.
import { mock } from 'bun:test';
import { PassThrough, Writable } from 'node:stream';
import assert from 'node:assert/strict';

const inputDescriptor = Object.getOwnPropertyDescriptor(process, 'stdin')!;
const outputDescriptor = Object.getOwnPropertyDescriptor(process, 'stdout')!;
const output = process.stdout;
let rendered = '';
const rawChanges: boolean[] = [];
const stdin = Object.assign(new PassThrough(), {
    isTTY: true,
    isRaw: false,
    setRawMode(value: boolean) {
        this.isRaw = value;
        rawChanges.push(value);
        return this;
    },
    ref() {},
    unref() {},
});
const stdout = Object.assign(
    new Writable({
        write(chunk, _encoding, done) {
            rendered += chunk.toString();
            done();
        },
    }),
    { isTTY: true, columns: 120, rows: 30 }
);
Object.defineProperty(process, 'stdin', { value: stdin });
Object.defineProperty(process, 'stdout', { value: stdout });
let loads = 0;
let opens = 0;
let pagerFinished = false;
let reads = 0;
let releaseBrowser: (() => void) | undefined;
let releaseNote: (() => void) | undefined;

mock.module('../../src/notes.ts', () => ({
    async getNotesAndUntrackedGoogleDocs() {
        loads++;
        if (loads === 1) throw new Error('initial load failed');
        if (loads === 3) throw new Error('refresh failed');
        return {
            notes: [{ id: 'example', title: 'Example note', tags: [] }],
            googleDocs: [],
        };
    },
    async openNoteLink() {
        opens++;
        if (opens === 1)
            await new Promise<void>(resolve => {
                releaseBrowser = resolve;
            });
        throw new Error('browser unavailable');
    },
    async openGoogleDocLink() {
        throw new Error('Unexpected Google Doc open');
    },
}));
mock.module('../../src/utils.ts', () => ({
    async getTT() {
        return {
            notes: {
                async getNoteById() {
                    reads++;
                    await new Promise<void>(resolve => {
                        releaseNote = resolve;
                    });
                    return { title: 'Example note', content: 'Body' };
                },
            },
        };
    },
}));
mock.module('../../src/tui-helpers.ts', () => ({
    clampSelection: (index: number, length: number) =>
        Math.max(0, Math.min(index, length - 1)),
    errorMessage: (error: unknown) =>
        error instanceof Error ? error.message : String(error),
    async runPager() {
        assert.equal(stdin.isRaw, false, 'pager starts in cooked mode');
        assert.equal(
            stdin.readableLength,
            0,
            'keys pressed during note loading are not buffered for the pager'
        );
        // less owns terminal mode after it starts; a delayed Ink effect must not reset it.
        stdin.setRawMode(true);
        const changes = rawChanges.length;
        await Bun.sleep(50);
        assert.equal(
            rawChanges.length,
            changes,
            'Ink must not reset terminal mode after pager starts'
        );
        pagerFinished = true;
    },
}));

async function waitFor(check: () => boolean, description: string) {
    const deadline = Date.now() + 3000;
    while (!check()) {
        if (Date.now() > deadline)
            throw new Error(`Timed out: ${description}; output: ${rendered}`);
        await Bun.sleep(10);
    }
    // Ensure Ink has flushed its input effects before sending the next key.
    await Bun.sleep(30);
}

async function assertBusyInputConsumed(start: number, label: string) {
    for (const key of ['o', 'v']) {
        stdin.write(key);
        await Bun.sleep(30);
        assert.equal(stdin.isRaw, true, `${label} keeps input in raw mode`);
        assert.equal(
            stdin.readableLength,
            0,
            `${label} consumes busy keystrokes`
        );
    }
    assert.ok(
        rawChanges.slice(start).every(value => value),
        `${label} never disables raw mode`
    );
}

const { runNotesTui } = await import('../../src/tui.tsx');
try {
    const running = runNotesTui();
    await waitFor(() => rendered.includes('initial load failed'), 'load error');
    // Neither shortcut is visible on the error screen, so neither may enter a
    // hidden mode that consumes the advertised retry or quit shortcut.
    if (process.argv[2] !== 'busy-only') {
        stdin.write(
            process.argv[2].endsWith('tag') || process.argv[2] === 'ctrl-c'
                ? 't'
                : '/'
        );
        await Bun.sleep(30);
    }
    if (process.argv[2].startsWith('error-q')) {
        stdin.write('q');
    } else {
        stdin.write('r');
        await waitFor(() => rendered.includes('Example note'), 'retry success');
        rendered = '';
        stdin.write('r');
        await waitFor(
            () => rendered.includes('refresh failed'),
            'refresh error'
        );
        assert.ok(
            rendered.includes('Example note'),
            'refresh failure preserves visible notes'
        );
        rendered = '';
        stdin.write('r');
        await waitFor(
            () => loads === 4 && rendered.includes('Example note'),
            'refresh retry'
        );
        assert.ok(
            !rendered.includes('refresh failed'),
            'successful retry clears load error'
        );
        const beforeBrowser = rawChanges.length;
        stdin.write('o');
        await waitFor(
            () => releaseBrowser !== undefined,
            'delayed browser launch'
        );
        await assertBusyInputConsumed(beforeBrowser, 'browser launch');
        assert.equal(opens, 1, 'busy input does not launch another browser');
        assert.equal(reads, 0, 'busy input does not load a note');
        releaseBrowser!();
        await waitFor(
            () => rendered.includes('browser unavailable'),
            'browser failure'
        );
        assert.equal(opens, 1);
        const beforeNote = rawChanges.length;
        stdin.write('v');
        await waitFor(() => releaseNote !== undefined, 'delayed note loading');
        await assertBusyInputConsumed(beforeNote, 'note loading');
        assert.equal(opens, 1, 'busy note input does not launch a browser');
        assert.equal(
            reads,
            1,
            'busy input does not start another note request'
        );
        releaseNote!();
        await waitFor(
            () => pagerFinished,
            'pager completes without raw mode race'
        );
        assert.equal(stdin.isRaw, true, 'TUI restores raw mode after pager');
        assert.equal(opens, 1, 'no browser keystrokes replayed after pager');
        assert.equal(reads, 1, 'no note keystrokes replayed after pager');
        rendered = '';
        stdin.write('j');
        await Bun.sleep(30);
        stdin.write('o');
        await waitFor(
            () => opens === 2 && rendered.includes('browser unavailable'),
            'navigation and actions resume after pager'
        );
        stdin.write(process.argv[2] === 'ctrl-c' ? '\x03' : 'q');
    }
    await running;
    assert.equal(stdin.isRaw, false, 'exit restores cooked input');
    assert.ok(rendered.includes('\x1b[?1049l'), 'exit leaves alternate screen');
    assert.ok(rendered.includes('\x1b[?25h'), 'exit shows cursor');
    for (const [event, name] of [
        ['SIGINT', 'onSigint'],
        ['SIGTERM', 'onSigterm'],
        ['exit', 'cleanup'],
    ]) {
        assert.ok(
            !process.listeners(event!).some(listener => listener.name === name),
            `${event} TUI listener removed`
        );
    }
    output.write('TUI scenario passed\n');
} finally {
    Object.defineProperty(process, 'stdin', inputDescriptor);
    Object.defineProperty(process, 'stdout', outputDescriptor);
}
