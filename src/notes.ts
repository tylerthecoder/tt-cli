import { DatabaseSingleton, TylersThings } from '@tt-services';
import type { NoteMetadata as NoteType, Note } from '@tt-services';
import { join } from 'path';
import { homedir } from 'os';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { exec } from 'child_process';

const CACHE_DIR = join(homedir(), '.cache', 'tt-cli');
const NOTES_CACHE_FILE = join(CACHE_DIR, 'notes.json');
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export const db = await DatabaseSingleton.getInstance();
export const tt = await TylersThings.make(db);

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
    const notes = await tt.notes.getAllNotesMetadata();

    try {
        const cacheData: CacheData = { timestamp: Date.now(), notes };
        await writeFile(NOTES_CACHE_FILE, JSON.stringify(cacheData, null, 2));
    } catch (error) {
        // Non-fatal
    }

    return notes;
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
    return tt.notes.getNoteById(id);
}

export function openNoteLink(id: string) {
    exec(`xdg-open https://tylertracy.com/notes/${id}`);
}