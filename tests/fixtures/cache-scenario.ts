import { mock } from 'bun:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';

let fetches = 0;
const notes = [{ id: 'test', title: 'Test note', tags: [] }];
mock.module('../../src/utils.ts', () => ({
    getTT: async () => ({
        notes: {
            getAllNotesMetadata: async () => {
                fetches++;
                return notes;
            },
        },
        googleNotes: {
            getAllNotesAndUntrackedGoogleDocs: async () => {
                fetches++;
                return { notes, googleDocs: [] };
            },
        },
    }),
}));
const api = await import('../../src/notes.ts');
const cacheDir = join(process.env.HOME!, '.cache', 'tt-cli');
assert.deepEqual(await api.getNotes(), notes);
assert.equal(fetches, 1);
assert.deepEqual(await Bun.file(join(cacheDir, 'notes.json')).json(), {
    timestamp: (await Bun.file(join(cacheDir, 'notes.json')).json()).timestamp,
    notes,
});
assert.deepEqual(await api.getNotes(), notes);
assert.equal(fetches, 1);
await Bun.write(join(cacheDir, 'notes.json'), '{invalid');
assert.deepEqual(await api.getNotes(), notes);
assert.equal(fetches, 2);
await Bun.write(
    join(cacheDir, 'notes.json'),
    JSON.stringify({ timestamp: 0, notes: [] })
);
assert.deepEqual(await api.getNotes(), notes);
assert.equal(fetches, 3);
assert.deepEqual(await api.getNotesAndUntrackedGoogleDocs(), {
    notes,
    googleDocs: [],
});
assert.equal(fetches, 4);
await api.getNotesAndUntrackedGoogleDocs();
assert.equal(fetches, 4);
await api.getNotesAndUntrackedGoogleDocs({ ignoreCache: true });
assert.equal(fetches, 5);
console.log('Cache scenario passed');
