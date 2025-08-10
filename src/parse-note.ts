import { join } from 'path';
import type { NoteType, Note } from '@tt-services';
import * as yaml from 'js-yaml';
import { readdir } from 'fs/promises';
import { readFile } from 'fs/promises';
import { getNoteById } from './notes.ts';
import { createInterface } from 'readline/promises';
import { writeFile } from 'fs/promises';
import type { CreatableNote } from '@tt-services/src/services/notes';
import { stat } from 'fs/promises';
import { existsSync } from 'fs';
import { getTT } from './tt-services.ts';

// Get the directory of the current file
const NOTES_DIR = "/home/tylord/dev/tt-notes/notes"

export { NOTES_DIR }; // Export the notes directory

// --- ANSI Color Codes (Copied for logging within the util) ---
// It might be better to pass a logger instance, but this is simpler for now.
const colors = {
    reset: "\x1b[0m",
    green: "\x1b[32m",
    red: "\x1b[31m",
    yellow: "\x1b[33m",
    cyan: "\x1b[36m",
    magenta: "\x1b[35m",
    blue: "\x1b[34m",
    dim: "\x1b[2m",
};

async function confirm(prompt: string) {
    const rl = createInterface({
        input: process.stdin,
        output: process.stdout
    });
    const answer = await rl.question(prompt);
    rl.close();
    return answer.toLowerCase() === 'y';
}

/**
 * Generates a filesystem-safe filename for a note, handling potential collisions.
 * @param title - The note's title (or a fallback like 'untitled').
 * @param noteId - The note's ID (used as a fallback if title is empty after sanitization).
 * @param existingFilenamesLowercase - A Set containing lowercase versions of existing filenames in the target directory to check for collisions.
 * @returns A safe filename (e.g., "my-note.md" or "my-note_1.md").
 */
export function generateSafeFilename(
    title: string,
    noteId: string,
    existingFilenamesLowercase: Set<string>
): string {
    const safeTitle = (title || 'untitled')
        .toLowerCase()
        .replace(/[^a-z0-9_.\-]+/g, '-') // Allow underscore, dot, hyphen
        .replace(/-+/g, '-')
        .replace(/^-+|-+$/g, '');

    let baseFileName = `${safeTitle || noteId}.md`; // Fallback to id if title becomes empty

    let finalFileName = baseFileName;
    let counter = 1;
    // Check for collisions (case-insensitive)
    while (existingFilenamesLowercase.has(finalFileName.toLowerCase())) {
        // Log collision warning using the imported colors? Or keep utils purely functional?
        // For now, let the caller handle logging if needed.
        console.warn(
            colors.yellow, // Assuming colors are accessible here if needed, otherwise remove logging
            `  - Filename collision detected internally for base: "${baseFileName}". Trying alternative...`,
            colors.reset,
        );
        finalFileName = `${safeTitle || noteId}_${counter++}.md`;
    }
    return finalFileName;
}

/**
 * Formats a note object into a markdown string with YAML frontmatter.
 * Requires a full Note object now.
 * @param note - The note object including id, date, updatedAt, title, content, tags.
 * @returns The markdown formatted string.
 */
export function formatNoteAsMarkdown(note: NoteType): string {
    if ('_id' in note) {
        delete note._id;
    }

    const allButContent = Object.fromEntries(Object.entries(note).filter(([key]) => key !== 'content'));

    const fmString = yaml.dump(allButContent, { skipInvalid: true });

    return [
        '---',
        fmString.trim(),
        '---',
        note.content,
    ].join('\n');
}

export type NoteFile = {
    content: string;
    path: string;
}

export async function extractFrontmatterFromMarkdownFile(file: NoteFile): Promise<Record<string, any> | null> {
    const lines = file.content.split('\n');

    if (lines[0]?.trim() === '---') {
        let fmEndIndex = -1;
        for (let i = 1; i < lines.length; i++) {
            if (lines[i].trim() === '---') {
                fmEndIndex = i;
                break;
            }
        }

        if (fmEndIndex === -1) {
            return null;
        }

        const frontmatterRaw = lines.slice(1, fmEndIndex).join('\n');
        try {
            const parsedYaml = yaml.load(frontmatterRaw);
            if (typeof parsedYaml === 'object') {
                return parsedYaml;
            } else {
                return null;
            }
        } catch (e) {
            return null;
        }
    }
    return null;
}

export function removeFrontmatterFromMarkdownFile(file: NoteFile): string {
    const lines = file.content.split('\n');

    if (lines[0]?.trim() === '---') {
        let fmEndIndex = -1;
        for (let i = 1; i < lines.length; i++) {
            if (lines[i].trim() === '---') {
                fmEndIndex = i;
                break;
            }
        }

        if (fmEndIndex !== -1) {
            return lines.slice(fmEndIndex + 1).join('\n');
        }
    }

    return file.content;
}

export async function extractNoteFromMarkdownFile(file: NoteFile): Promise<NoteType | null> {
    const frontmatter = await extractFrontmatterFromMarkdownFile(file);

    if (!frontmatter) {
        console.warn(colors.yellow, 'Note file has no frontmatter, skipping', colors.reset);
        return null;
    }

    const content = removeFrontmatterFromMarkdownFile(file);

    const id = frontmatter?.id ?? null;
    if (!id) {
        console.warn(colors.yellow, 'Note file has no id, skipping', colors.reset);
        return null;
    }

    const createdAt = frontmatter?.createdAt ?? null;
    if (!createdAt) {
        console.warn(colors.yellow, 'Note file has no createdAt, skipping', colors.reset);
        return null;
    }

    const updatedAt = frontmatter?.updatedAt ?? null;
    if (!updatedAt) {
        console.warn(colors.yellow, 'Note file has no updatedAt, skipping', colors.reset);
        return null;
    }

    const title = file.path.split('/').pop()?.split('.').shift() ?? null;
    if (!title) {
        console.warn(colors.yellow, 'Note file has no title, skipping', colors.reset);
        return null;
    }

    const published = frontmatter?.published ?? false;

    const tags = frontmatter?.tags ?? null;

    const extraData = Object.fromEntries(Object.entries(frontmatter).filter(([key]) => key !== 'id' && key !== 'createdAt' && key !== 'updatedAt' && key !== 'tags' && key !== 'published'));


    return { id, title, content, createdAt, updatedAt, tags, date: createdAt, published, ...extraData }
}

export async function tryFormatMarkdownFiles(file: NoteFile, should_confirm: boolean = true) {
    const frontmatter = await extractFrontmatterFromMarkdownFile(file);

    if (!frontmatter) {
        console.warn(colors.yellow, 'Note file has no frontmatter, skipping', colors.reset);
        return null;
    }

    const id = frontmatter?.id ?? null;
    if (!id) {
        console.warn(colors.yellow, 'Note file has no id, skipping', colors.reset);
        return null;
    }

    const note = await getNoteById(id);

    if (!note) {
        console.warn(colors.yellow, 'Note file has no note, skipping', colors.reset);
        return null;
    }

    if (should_confirm) {
        const confirmed = await confirm(`Format note ${id}? (y/n)`);

        if (!confirmed) {
            console.log(colors.yellow, 'Skipping note', colors.reset);
            return null;
        }
    }

    const newContent = formatNoteAsMarkdown(note);

    await writeFile(file.path, newContent);
}

// Only return notes that aren't in the system right now
export async function extractCreatableNote(file: NoteFile): Promise<CreatableNote | null> {
    const frontmatter = await extractFrontmatterFromMarkdownFile(file);

    const id = frontmatter?.id ?? null;
    // Note already exists, skip
    if (id) {
        return null;
    }

    const title = typeof frontmatter?.title === 'string' ? frontmatter.title : file.path.split('/').pop()?.split('.').shift();
    if (!title) {
        console.warn(colors.yellow, 'Note file has no title, skipping', colors.reset);
        return null;
    }

    const date = typeof frontmatter?.date === 'string' ? frontmatter.date : (await stat(file.path)).mtime.toISOString();
    if (!date) {
        console.warn(colors.yellow, 'Note file has no date, skipping', colors.reset);
        return null;
    }

    const tags = frontmatter?.tags ?? [];

    const content = removeFrontmatterFromMarkdownFile(file);

    return {
        title: title,
        content: content,
        date: date,
        tags: tags,
    }

}



export async function getNoteFilePaths(dir: string = NOTES_DIR) {
    let files: string[];
    try {
        files = await readdir(dir);
    } catch (dirError) {
        console.error(
            colors.red,
            `Error reading notes directory ${dir}:`,
            dirError,
            colors.reset,
        );
        throw dirError;
    }

    return files.filter((f) => f.toLowerCase().endsWith(".md")).map((f) => join(dir, f));
}


/**
 * Scans the notes directory for markdown files, parses them,
 * and returns an array of results.
 * @param notesDir - Optional directory override. If not provided, uses the default NOTES_DIR.
 * @returns A promise that resolves with an array of LocalNoteScanResult.
 */
export async function scanNotesDirectory(notesDir: string = NOTES_DIR) {
    const files = await getNoteFilePaths(notesDir);

    const notes: { note: NoteType, path: string }[] = [];

    for (const filePath of files) {
        const content = await readFile(filePath, "utf8");
        const note = await extractNoteFromMarkdownFile({ content, path: filePath });

        if (!note) {
            continue;
        }

        notes.push({ note, path: filePath });
    }

    return notes;
}

export async function formatAllNotes(dir: string = NOTES_DIR, should_confirm: boolean = true) {
    const files = await getNoteFilePaths(dir);

    for (const filePath of files) {
        const content = await readFile(filePath, "utf8");
        await tryFormatMarkdownFiles({ content, path: filePath }, should_confirm);
    }
}

export async function extractCreatableNotes(dir: string = NOTES_DIR) {
    const files = await getNoteFilePaths(dir);

    const creatableNotes: { path: string, note: CreatableNote }[] = [];

    for (const filePath of files) {
        const note = await extractCreatableNote({ content: await readFile(filePath, "utf8"), path: filePath });
        if (note) {
            creatableNotes.push({ path: filePath, note: note });
        }
    }

    return creatableNotes;
}

export async function findRemoteNotesToDownload(dir: string = NOTES_DIR): Promise<NoteType[]> {
    const notes = await scanNotesDirectory(dir);

    const tt = await getTT();
    const remoteNotes = await tt.notes.getAllNotesMetadata();


    const notesToDownload: NoteType[] = [];

    for (const { note } of notes) {
        if (remoteNotes.some((remoteNote) => remoteNote.id === note.id)) {
            continue;
        }

        notesToDownload.push(note);
    }

    return notesToDownload;
}

type Conflict = {
    local: { note: NoteType, path: string };
    remote: Note;
    conflictType: Array<string>;
}

export async function findConflicts(dir: string = NOTES_DIR) {
    const notes = await scanNotesDirectory(dir);
    const tt = await getTT();
    const remoteNotes = await tt.notes.getAllNotes();

    const conflicts: Conflict[] = [];

    for (const { note, path } of notes) {
        const remoteNote = remoteNotes.find((remoteNote) => remoteNote.id === note.id);
        if (remoteNote) {
            let conflictType: Array<string> = [];
            if (remoteNote.title !== note.title) {
                conflictType.push("title");
            }
            if (remoteNote.date !== note.date) {
                conflictType.push("date");
            }
            if (JSON.stringify(remoteNote.tags ?? []) !== JSON.stringify(note.tags ?? [])) {
                conflictType.push("tags");
            }
            const localContentNoFrontmatter = removeFrontmatterFromMarkdownFile({ content: note.content, path: path });
            if (localContentNoFrontmatter !== remoteNote.content) {
                conflictType.push("content");
            }

            // Check if any of the other keys are different
            const otherKeys = Object.keys(note).filter((key) => key !== "id" && key !== "title" && key !== "date" && key !== "tags" && key !== "content");
            for (const key of otherKeys) {
                if (remoteNote[key as keyof Note] !== note[key as keyof Note]) {
                    conflictType.push(key);
                }
            }

            if (conflictType.length > 0) {
                conflicts.push({
                    local: { note, path },
                    remote: remoteNote,
                    conflictType: conflictType
                });
            }
        }
    }

    return conflicts;
}


export async function syncNotes(dir: string = NOTES_DIR, should_confirm: boolean = true) {
    const tt = await getTT();
    const creatableNotes = await extractCreatableNotes(dir);
    if (creatableNotes.length > 0) {
        console.log(colors.green, `Found ${creatableNotes.length} notes on local to push to server. \n - ${creatableNotes.map(({ note }) => note.title).join("\n - ")}`, colors.reset);
        const confirmCreate = await confirm("Create notes? (y/n)");
        if (confirmCreate) {
            for (const { path, note } of creatableNotes) {
                console.log(colors.green, `Note: ${note.title}`, colors.reset);

                if (should_confirm) {
                    const allButContent = Object.fromEntries(Object.entries(note).filter(([key]) => key !== 'content'));
                    const confirmed = await confirm(`Create note ${note.title}? (y/n)\n${JSON.stringify(allButContent, null, 2)}`);

                    if (!confirmed) {
                        console.log(colors.yellow, `Skipping note ${note.title}`, colors.reset);
                        continue;
                    }
                }

                const createdNote = await tt.notes.createNote(note);

                console.log(colors.green, `Created note: ${createdNote.title}`, colors.reset);

                const newContent = formatNoteAsMarkdown(createdNote);
                await writeFile(path, newContent);
            }
        }
    } else {
        console.log(colors.yellow, "No notes to create", colors.reset);
    }

    // Now download notes from remote
    const notesToDownload = await findRemoteNotesToDownload(dir);

    if (notesToDownload.length > 0) {
        console.log(colors.green, "Found notes to download from server: ", notesToDownload.length, "\n", notesToDownload.map((note) => note.title).join("\n"), colors.reset);

        const confirmDownload = await confirm("Download notes from server? (y/n)");

        if (confirmDownload) {
            for (const note of notesToDownload) {
                const newContent = formatNoteAsMarkdown(note);
                const filePath = join(dir, `${note.title}.md`);
                if (existsSync(filePath)) {
                    console.log(colors.yellow, `Note ${note.title} already exists, skipping`, colors.reset);
                    continue;
                }
                await writeFile(filePath, newContent);
                console.log(colors.green, `Downloaded note: ${note.title}`, colors.reset);
            }
        }

    } else {
        console.log(colors.yellow, "No notes to download", colors.reset);
    }

    const conflicts = await findConflicts(dir);
    if (conflicts.length > 0) {
        console.log(colors.yellow, "No conflicts found", colors.reset);
        for (const conflict of conflicts) {
            const remoteContent = formatNoteAsMarkdown(conflict.remote);
            await writeFile(conflict.local.path, remoteContent);
            console.log(colors.green, `Note: ${conflict.remote.title} - Conflict Types: (${conflict.conflictType.join(", ")})`, colors.reset);
        }
        const doneEditingConfirm = await confirm("Press yes when you are done editing and ready to push changes to server (y/n)")

        if (doneEditingConfirm) {
            // find conflicts again, for each conflict, ask the user if they want to push the changes to the server
            const conflicts = await findConflicts(dir);
            for (const conflict of conflicts) {
                console.log(colors.green, `Note: ${conflict.remote.title}`, colors.reset);
                console.log(colors.green, `Conflicts: ${conflict.conflictType.join(", ")}`, colors.reset);
                const confirmed = await confirm(`Push changes to server for note ${conflict.remote.title}? (y/n)`);
                if (confirmed) {
                    await tt.notes.updateNote(conflict.remote.id, conflict.local.note);
                }
            }
        }
    } else {
        console.log(colors.yellow, "No conflicts found", colors.reset);
    }

    console.log(colors.green, "Sync complete 🤸", colors.reset);

}