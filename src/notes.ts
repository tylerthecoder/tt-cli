import type { NoteMetadata as NoteType, Note } from '@tt-services';
import { join } from 'path';
import { homedir } from 'os';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { $ } from 'bun';
import { getTT } from './tt-services';

const CACHE_DIR = join(homedir(), '.cache', 'tt-cli');
const NOTES_CACHE_FILE = join(CACHE_DIR, 'notes.json');
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

interface CacheData {
    timestamp: number;
    notes: NoteType[];
}

async function ensureCacheDir() {
    if (!existsSync(CACHE_DIR)) {
        await mkdir(CACHE_DIR, { recursive: true });
    }
}

export async function getNotes(): Promise<NoteType[]> {
    await ensureCacheDir();

    try {
        if (existsSync(NOTES_CACHE_FILE)) {
            const cacheContent = await readFile(NOTES_CACHE_FILE, 'utf-8');
            const cache: CacheData = JSON.parse(cacheContent);
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
        await writeFile(NOTES_CACHE_FILE, JSON.stringify(cacheData, null, 2));
    } catch (error) {
        // Non-fatal
    }

    return notes;
}

export async function getNotesAndUntrackedGoogleDocs(options: { ignoreTimeout?: boolean; ignoreCache?: boolean } = {}) {
    const GOOGLE_NOTES_CACHE_FILE = join(CACHE_DIR, 'google-notes.json');

    await ensureCacheDir();

    // Check cache unless ignoreCache is true
    if (!options.ignoreCache) {
        try {
            if (existsSync(GOOGLE_NOTES_CACHE_FILE)) {
                const cacheContent = await readFile(GOOGLE_NOTES_CACHE_FILE, 'utf-8');
                const cache: CacheData & { googleDocs: any[] } = JSON.parse(cacheContent);

                // Return cached data if within TTL or ignoreTimeout is true
                if (options.ignoreTimeout || Date.now() - cache.timestamp <= CACHE_TTL) {
                    return { notes: cache.notes, googleDocs: cache.googleDocs };
                }
            }
        } catch (error) {
            // Non-fatal; fall back to fetching fresh
        }
    }

    const tt = await getTT();
    const notesAndUntrackedGoogleDocs = await tt.googleNotes.getAllNotesAndUntrackedGoogleDocs("tylertracy1999@gmail.com");

    // Always write to cache (even when ignoreCache is true)
    try {
        const cacheData = {
            timestamp: Date.now(),
            notes: notesAndUntrackedGoogleDocs.notes,
            googleDocs: notesAndUntrackedGoogleDocs.googleDocs
        };
        await writeFile(GOOGLE_NOTES_CACHE_FILE, JSON.stringify(cacheData, null, 2));
    } catch (error) {
        // Non-fatal
    }

    return notesAndUntrackedGoogleDocs;
}

export function filterNotes(notes: NoteType[], options: { published?: boolean; tag?: string; date?: string }) {
    let filtered = [...notes];
    if (options.published) filtered = filtered.filter(n => n.published);
    if (options.tag) filtered = filtered.filter(n => n.tags?.includes(options.tag as string));
    if (options.date) filtered = filtered.filter(n => n.date === options.date);
    return filtered;
}

export function displayNotes(notes: NoteType[], format: 'text' | 'json' = 'text') {
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

export async function openNoteLink(id: string) {
    await $`xdg-open https://tylertracy.com/notes/${id}`.quiet();
}

export async function openGoogleDocLink(id: string) {
    await $`xdg-open https://docs.google.com/document/d/${id}`.quiet();
}