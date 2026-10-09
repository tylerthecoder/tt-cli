// Isolate service/config mocks from the test runner and use only temporary files.
import { mock } from 'bun:test';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';

const dir = await mkdtemp(join(tmpdir(), 'tt-note-files-'));
const notesDir = join(dir, 'notes');
await mkdir(notesDir);
const logger = { child: () => logger, info() {}, warn() {}, error() {} };
let confirmations = 0;
mock.module('../../src/config.ts', () => ({ NOTES_DIR: undefined }));
mock.module('../../src/utils.ts', () => ({
    logger,
    async confirm() {
        confirmations++;
        return false;
    },
    getTT() {
        throw new Error('Tests must not call remote services');
    },
    pickOptionCli() {
        throw new Error('Unexpected prompt');
    },
}));

try {
    const {
        generateNoteFilename,
        saveNoteToFs,
        scanNotesDirectory,
        extractCreatableNotes,
        extractNoteFromMarkdownFile,
        extractCreatableNoteFromMarkdownFile,
    } = await import('../../src/parse-note.ts');
    const note = {
        id: 'id-1',
        title: 'A note',
        content: 'Original body\n',
        createdAt: '2026-10-09T12:00:00.000Z',
        updatedAt: '2026-10-09T12:00:00.000Z',
        date: '2026-10-09',
        tags: ['test'],
        published: false,
    };
    assert.equal(await generateNoteFilename(note, notesDir), 'a-note.md');
    await saveNoteToFs(note, { dir: notesDir, shouldLog: false });
    assert.equal(await Bun.file(join(notesDir, 'a-note.md')).exists(), true);
    assert.notEqual(await generateNoteFilename(note, notesDir), 'a-note.md');
    let notes = await scanNotesDirectory(notesDir);
    assert.equal(notes.length, 1);
    assert.equal(notes[0]!.note.content, note.content);
    assert.equal(notes[0]!.note.createdAt, note.createdAt);

    await saveNoteToFs(
        { ...note, content: 'Updated body', title: 'New title' },
        { dir: notesDir, shouldLog: false }
    );
    notes = await scanNotesDirectory(notesDir);
    assert.equal(notes.length, 1);
    assert.equal(notes[0]!.path, join(notesDir, 'a-note.md'));
    assert.equal(notes[0]!.note.content, 'Updated body');
    await saveNoteToFs(note, {
        dir: notesDir,
        confirmOverwrite: true,
        shouldLog: false,
    });
    assert.equal(confirmations, 1);
    assert.equal(
        (await scanNotesDirectory(notesDir))[0]!.note.content,
        'Updated body'
    );

    await Bun.write(
        join(notesDir, 'new.md'),
        '---\ntitle: New note\ndate: 2026-10-09\ntags: [draft]\n---\nDraft body'
    );
    const creatable = await extractCreatableNotes(notesDir);
    assert.equal(creatable.length, 1);
    assert.equal(creatable[0]!.note.date, '2026-10-09');
    assert.equal(creatable[0]!.note.content, 'Draft body');
    for (const identity of [
        'id: first\nid: second',
        'id: first\n"id": null',
        'id: first\n"i\\u0064": null',
    ]) {
        const file = {
            path: join(notesDir, 'invalid.md'),
            content: `---\n${identity}\ntitle: Example\ncreatedAt: 2026-10-09\nupdatedAt: 2026-10-09\n---\nBody`,
        };
        assert.equal(
            await extractNoteFromMarkdownFile(file),
            null,
            'duplicate IDs must not associate a file with a remote note'
        );
        assert.equal(
            await extractCreatableNoteFromMarkdownFile(file),
            null,
            'invalid frontmatter must not become a new note'
        );
    }
    for (const content of [
        '---\ntitle: Missing end',
        '---\nbroken: [\n---\nBody',
        '---\n[id]\n---\nBody',
    ]) {
        assert.equal(
            await extractCreatableNoteFromMarkdownFile({
                path: join(notesDir, 'invalid.md'),
                content,
            }),
            null,
            'present but invalid frontmatter must be skipped'
        );
    }
    process.stdout.write('Note filesystem scenario passed\n');
} finally {
    await rm(dir, { recursive: true, force: true });
}
