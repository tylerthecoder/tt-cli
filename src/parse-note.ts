import { join } from 'path';
import type { NoteType, Note } from '@tt-services';
import * as yaml from 'js-yaml';
import { readdir, readFile, writeFile, stat, exists } from 'fs/promises';
import { getNoteById } from './notes.ts';
import type { CreatableNote } from '@tt-services/src/services/notes';
import { confirm, getTT, logger as baseLogger } from './utils.ts';
import { NOTES_DIR } from './config.ts';

const logger = baseLogger.child({
    module: "parse-note",
    filename: import.meta.url,
});

const requireNotesDir = (dir?: string) => {
    const notesDir = dir ?? NOTES_DIR;
    if (!notesDir) {
        logger.error({ dirCandidate: dir }, "Notes directory not set");
        process.exit(1);
    }
    return notesDir;
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
        logger.warn({ baseFileName, currentName: finalFileName }, 'Filename collision detected; trying alternative');
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
        logger.warn({ path: file.path }, 'Note file has no frontmatter, skipping');
        return null;
    }

    const content = removeFrontmatterFromMarkdownFile(file);

    const id = frontmatter?.id ?? null;
    if (!id) {
        logger.warn({ path: file.path }, 'Note file has no id, skipping');
        return null;
    }

    const createdAt = frontmatter?.createdAt ?? null;
    if (!createdAt) {
        logger.warn({ path: file.path, id }, 'Note file has no createdAt, skipping');
        return null;
    }

    const updatedAt = frontmatter?.updatedAt ?? null;
    if (!updatedAt) {
        logger.warn({ path: file.path, id }, 'Note file has no updatedAt, skipping');
        return null;
    }

    const title = file.path.split('/').pop()?.split('.').shift() ?? null;
    if (!title) {
        logger.warn({ path: file.path, id }, 'Note file has no title, skipping');
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
        logger.warn({ path: file.path }, 'Note file has no frontmatter, skipping');
        return null;
    }

    const id = frontmatter?.id ?? null;
    if (!id) {
        logger.warn({ path: file.path }, 'Note file has no id, skipping');
        return null;
    }

    const note = await getNoteById(id);

    if (!note) {
        logger.warn({ path: file.path, id }, 'Note file has no note, skipping');
        return null;
    }

    if (should_confirm) {
        const confirmed = await confirm(logger, `Format note ${id}? (y/n)`);

        if (!confirmed) {
            logger.info({ path: file.path, id }, 'Skipping note');
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
        logger.warn({ path: file.path }, 'Note file has no title, skipping');
        return null;
    }

    const date = typeof frontmatter?.date === 'string' ? frontmatter.date : (await stat(file.path)).mtime.toISOString();
    if (!date) {
        logger.warn({ path: file.path, title }, 'Note file has no date, skipping');
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



export async function getNoteFilePaths(dir?: string) {
    dir = requireNotesDir(dir);
    let files: string[];
    try {
        files = await readdir(dir);
    } catch (dirError) {
        logger.error({ error: dirError, dir }, 'Error reading notes directory');
        throw dirError;
    }

    return files.filter((f) => f.toLowerCase().endsWith(".md")).map((f) => join(dir, f));
}

export async function scanNotesDirectory(notesDir?: string) {
    notesDir = requireNotesDir(notesDir);
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

export async function formatAllNotes(dir?: string, should_confirm: boolean = true) {
    dir = requireNotesDir(dir);
    const files = await getNoteFilePaths(dir);

    for (const filePath of files) {
        const content = await readFile(filePath, "utf8");
        await tryFormatMarkdownFiles({ content, path: filePath }, should_confirm);
    }
}

export async function extractCreatableNotes(dir?: string) {
    dir = requireNotesDir(dir);
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

export async function findRemoteNotesToDownload(dir?: string): Promise<NoteType[]> {
    dir = requireNotesDir(dir);
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

export async function findConflicts(dir?: string) {
    dir = requireNotesDir(dir);
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


export async function syncNotes(dir?: string, should_confirm: boolean = true) {
    dir = requireNotesDir(dir);
    const tt = await getTT();

    // ========
    // Find local notes that don't exist on the server
    // ========
    const creatableNotes = await extractCreatableNotes(dir);
    if (creatableNotes.length > 0) {
        logger.info({ count: creatableNotes.length, titles: creatableNotes.map(({ note }) => note.title) }, 'Found notes on local to push to server');
        const confirmCreate = await confirm(logger, "Create notes? (y/n)");
        if (confirmCreate) {
            for (const { path, note } of creatableNotes) {
                logger.info({ title: note.title, path }, 'Creating note');

                if (should_confirm) {
                    const allButContent = Object.fromEntries(Object.entries(note).filter(([key]) => key !== 'content'));
                    const confirmed = await confirm(logger, `Create note ${note.title}? (y/n)\n${JSON.stringify(allButContent, null, 2)}`);

                    if (!confirmed) {
                        logger.info({ title: note.title, path }, 'Skipping note creation');
                        continue;
                    }
                }

                const createdNote = await tt.notes.createNote(note);

                logger.info({ title: createdNote.title, id: createdNote.id }, 'Created note');

                const newContent = formatNoteAsMarkdown(createdNote);
                await writeFile(path, newContent);
            }
        }
    } else {
        logger.info("No notes to create");
    }

    // ========
    // Find remote notes that don't exist locally
    // ========
    const notesToDownload = await findRemoteNotesToDownload(dir);

    if (notesToDownload.length > 0) {
        logger.info({ count: notesToDownload.length, titles: notesToDownload.map((note) => note.title) }, 'Found notes to download from server');

        const confirmDownload = await confirm(logger, "Download notes from server? (y/n)");

        if (confirmDownload) {
            for (const note of notesToDownload) {
                const newContent = formatNoteAsMarkdown(note);
                const filePath = join(dir, `${note.title}.md`);

                if (await exists(filePath)) {
                    logger.warn({ title: note.title, filePath }, 'Note already exists locally, skipping');
                    continue;
                }
                await writeFile(filePath, newContent);
                logger.info({ title: note.title, filePath }, 'Downloaded note');
            }
        }

    } else {
        logger.info("No notes to download");
    }

    // ========
    // Find conflicts between local and remote notes
    // ========
    const conflicts = await findConflicts(dir);
    if (conflicts.length > 0) {
        logger.warn({ count: conflicts.length }, 'Conflicts found');
        for (const conflict of conflicts) {
            const remoteContent = formatNoteAsMarkdown(conflict.remote);
            await writeFile(conflict.local.path, remoteContent);
            logger.info({ title: conflict.remote.title, conflictTypes: conflict.conflictType, path: conflict.local.path }, 'Wrote remote content to local file to resolve conflict');
        }
        const doneEditingConfirm = await confirm(logger, "Press yes when you are done editing and ready to push changes to server (y/n)")

        if (doneEditingConfirm) {
            // find conflicts again, for each conflict, ask the user if they want to push the changes to the server
            const conflicts = await findConflicts(dir);
            for (const conflict of conflicts) {
                logger.info({ title: conflict.remote.title }, 'Conflict remains after edit');
                logger.info({ conflictTypes: conflict.conflictType }, 'Conflict details');
                const confirmed = await confirm(logger, `Push changes to server for note ${conflict.remote.title}? (y/n)`);
                if (confirmed) {
                    await tt.notes.updateNote(conflict.remote.id, conflict.local.note);
                }
            }
        }
    } else {
        logger.info("No conflicts found");
    }

    logger.info("Sync complete 🤸");

    await tt.disconnect();
}