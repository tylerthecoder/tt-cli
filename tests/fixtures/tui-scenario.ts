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

const { runNotesTui } = await import('../../src/tui.tsx');
try {
    const running = runNotesTui();
    await waitFor(() => rendered.includes('initial load failed'), 'load error');
    stdin.write('r');
    await waitFor(() => rendered.includes('Example note'), 'retry success');
    rendered = '';
    stdin.write('r');
    await waitFor(() => rendered.includes('refresh failed'), 'refresh error');
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
    stdin.write('o');
    await waitFor(
        () => rendered.includes('browser unavailable'),
        'browser failure'
    );
    assert.equal(opens, 1);
    stdin.write('v');
    await waitFor(() => pagerFinished, 'pager completes without raw mode race');
    assert.equal(stdin.isRaw, true, 'TUI restores raw mode after pager');
    rendered = '';
    stdin.write('j');
    await Bun.sleep(30);
    stdin.write('o');
    await waitFor(
        () => opens === 2 && rendered.includes('browser unavailable'),
        'navigation and actions resume after pager'
    );
    stdin.write(process.argv[2] === 'ctrl-c' ? '\x03' : 'q');
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
