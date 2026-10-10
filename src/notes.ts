import type { NoteMetadata as NoteType, Note } from '@tt-services';
import { join } from 'path';
import { homedir } from 'os';
export { openNoteLink, openGoogleDocLink } from './browser.ts';
import { getTT } from './utils.ts';

const CACHE_DIR = join(homedir(), '.cache', 'tt-cli');
const NOTES_CACHE_FILE = join(CACHE_DIR, 'notes.json');
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

interface CacheData {
    timestamp: number;
    notes: NoteType[];
}

export async function getNotes(): Promise<NoteType[]> {
    try {
        if (await Bun.file(NOTES_CACHE_FILE).exists()) {
            const cache: CacheData = await Bun.file(NOTES_CACHE_FILE).json();
            if (Date.now() - cache.timestamp <= CACHE_TTL) {
                return cache.notes;
            }
        }
    } catch (error) {
        // Non-fatal; fall back to fetching fresh
    }
    const tt = await getTT();
    const notes = await tt.notes.getAllNotesMetadata();

    try {
        const cacheData: CacheData = { timestamp: Date.now(), notes };
        await Bun.write(NOTES_CACHE_FILE, JSON.stringify(cacheData, null, 2));
    } catch (error) {
        // Non-fatal
    }

    return notes;
}

export async function getNotesAndUntrackedGoogleDocs(
    options: { ignoreTimeout?: boolean; ignoreCache?: boolean } = {}
) {
    const GOOGLE_NOTES_CACHE_FILE = join(CACHE_DIR, 'google-notes.json');

    // Check cache unless ignoreCache is true
    if (!options.ignoreCache) {
        try {
            if (await Bun.file(GOOGLE_NOTES_CACHE_FILE).exists()) {
                const cache: CacheData & { googleDocs: any[] } = await Bun.file(
                    GOOGLE_NOTES_CACHE_FILE
                ).json();

                // Return cached data if within TTL or ignoreTimeout is true
                if (
                    options.ignoreTimeout ||
                    Date.now() - cache.timestamp <= CACHE_TTL
                ) {
                    return { notes: cache.notes, googleDocs: cache.googleDocs };
                }
            }
        } catch (error) {
            // Non-fatal; fall back to fetching fresh
        }
    }

    const tt = await getTT();
    const notesAndUntrackedGoogleDocs =
        await tt.googleNotes.getAllNotesAndUntrackedGoogleDocs(
            'tylertracy1999@gmail.com'
        );

    // Always write to cache (even when ignoreCache is true)
    try {
        const cacheData = {
            timestamp: Date.now(),
            notes: notesAndUntrackedGoogleDocs.notes,
            googleDocs: notesAndUntrackedGoogleDocs.googleDocs,
        };
        await Bun.write(
            GOOGLE_NOTES_CACHE_FILE,
            JSON.stringify(cacheData, null, 2)
        );
    } catch (error) {
        // Non-fatal
    }

    return notesAndUntrackedGoogleDocs;
}

export function filterNotes(
    notes: NoteType[],
    options: { published?: boolean; tag?: string; date?: string }
) {
    let filtered = [...notes];
    if (options.published) filtered = filtered.filter(n => n.published);
    if (options.tag)
        filtered = filtered.filter(n =>
            n.tags?.includes(options.tag as string)
        );
    if (options.date) filtered = filtered.filter(n => n.date === options.date);
    return filtered;
}

export function displayNotes(
    notes: NoteType[],
    format: 'text' | 'json' = 'text'
) {
    if (format === 'json') {
        console.log(JSON.stringify(notes, null, 2));
        return;
    }
    notes.forEach(note => {
        console.log(`\n--- ${note.title} ---`);
        console.log(`ID: ${note.id}`);
        console.log(`Date: ${note.date}`);
        console.log(`Published: ${note.published}`);
        console.log(`Tags: ${note.tags?.join(', ') || 'No tags'}`);
    });
}

export async function getNoteById(id: string): Promise<Note | null> {
    const tt = await getTT();
    return tt.notes.getNoteById(id);
}
