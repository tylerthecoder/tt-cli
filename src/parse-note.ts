import path, { join } from 'path';
import type { NoteType, Note } from '@tt-services';
import * as yaml from 'js-yaml';
import { readdir, readFile, writeFile, stat, exists, unlink } from 'fs/promises';
import type { CreatableNote, NoteMetadata } from '@tt-services/src/services/notes';
import { confirm, getTT, logger as baseLogger, pickOptionCli } from './utils.ts';
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

export const getPrintableNoteContent = (note: NoteType | CreatableNote) => {
    return Object.fromEntries(Object.entries(note).filter(([key]) => key !== 'content' && key !== "googleDocContent"));
}



export async function generateNoteFilename(noteMetadata: NoteMetadata, notesDir?: string): Promise<string> {
    let safeTitle = noteMetadata.title
        .toLowerCase()
        .replace(/[^a-z0-9_.\-]+/g, '-') // Allow underscore, dot, hyphen
        .replace(/-+/g, '-')
        .replace(/^-+|-+$/g, '');

    notesDir = requireNotesDir(notesDir);

    while (true) {
        const notePath = path.join(notesDir, `${safeTitle}.md`);
        if (!await exists(notePath)) {
            break;
        }
        safeTitle = `${safeTitle}-${Math.random().toString(36).substring(2, 15)}`;
    }

    return `${safeTitle}.md`;
}

export function formatNoteAsMarkdown(note: NoteType): string {
    if ('_id' in note) {
        delete note._id;
    }

    const allButContent = getPrintableNoteContent(note);

    const fmString = yaml.dump(allButContent, { skipInvalid: true });

    return [
        '---',
        fmString.trim(),
        '---',
        note.content,
    ].join('\n');
}

export async function saveNoteToFs(note: NoteType, opts: { dir?: string, path?: string, confirmOverwrite?: boolean, shouldLog?: boolean } = { dir: undefined, confirmOverwrite: false, shouldLog: true }) {
    const filename = await generateNoteFilename(note);
    const content = formatNoteAsMarkdown(note);
    const notesDir = requireNotesDir(opts.dir);

    const allLocalNotes = await scanNotesDirectory(notesDir);
    const existingNote = allLocalNotes.find(({ note: localNote }) => localNote.id === note.id);

    if (existingNote) {
        logger.info({ noteToSave: note, existingNote }, 'Note already exists locally');
    }

    if (opts.path && existingNote) {
        logger.error({ noteToSave: note, existingNote }, 'Path provided but note already exists locally');
        throw new Error('Path provided but note already exists locally');
    }

    const filePath = opts.path ?? (existingNote ? existingNote.path : path.join(notesDir, filename));

    const confirmOverwrite = opts.confirmOverwrite ?? false;
    if (confirmOverwrite && await exists(filePath)) {
        const confirmed = await confirm(logger, `Note already exists locally at ${filePath}, overwrite?`);
        if (!confirmed) {
            logger.info({ title: note.title, path: filePath }, 'Skipping note');
            return;
        }
    }
    await writeFile(filePath, content);
    if (opts.shouldLog ?? true) {
        logger.info({ title: note.title, path: filePath, id: note.id }, 'Saved note to file system');
    }
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

    const title = frontmatter?.title ?? null;
    if (!title) {
        logger.warn({ path: file.path, id }, 'Note file has no title, skipping');
        return null;
    }

    const published = frontmatter?.published ?? false;

    const tags = frontmatter?.tags ?? null;

    const extraData = Object.fromEntries(Object.entries(frontmatter).filter(([key]) => key !== 'id' && key !== 'createdAt' && key !== 'updatedAt' && key !== 'tags' && key !== 'published'));


    return { id, title, content, createdAt, updatedAt, tags, date: createdAt, published, ...extraData }
}

// Only return notes that aren't in the system
export async function findUnsyncedLocalNotes(file: NoteFile): Promise<CreatableNote | null> {
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

export async function extractCreatableNotes(dir?: string) {
    dir = requireNotesDir(dir);
    const files = await getNoteFilePaths(dir);

    const creatableNotes: { path: string, note: CreatableNote }[] = [];

    for (const filePath of files) {
        const note = await findUnsyncedLocalNotes({ content: await readFile(filePath, "utf8"), path: filePath });
        if (note) {
            creatableNotes.push({ path: filePath, note: note });
        }
    }

    return creatableNotes;
}

export async function findLocalNotesMissingOnServer(dir?: string): Promise<Array<{ note: NoteType, path: string }>> {
    dir = requireNotesDir(dir);
    const notes = await scanNotesDirectory(dir);

    const tt = await getTT();
    const remoteNotes = await tt.notes.getAllNotesMetadata();


    const notesMissingOnServer: Array<{ note: NoteType, path: string }> = [];

    for (const { note, path } of notes) {
        if (remoteNotes.some((remoteNote) => remoteNote.id === note.id)) {
            continue;
        }

        notesMissingOnServer.push({ note, path });
    }

    return notesMissingOnServer;
}

export async function findRemoteNotesToDownload(dir?: string): Promise<Note[]> {
    dir = requireNotesDir(dir);
    const localNotes = await scanNotesDirectory(dir);

    const tt = await getTT();
    const remoteNotes = await tt.notes.getAllNotes();

    const localIds = new Set(localNotes.map(({ note }) => note.id));
    const notesToDownload: Note[] = [];
    for (const remoteNote of remoteNotes) {
        if (!localIds.has(remoteNote.id)) {
            notesToDownload.push(remoteNote);
        }
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
        const confirmCreate = await confirm(logger, "Create notes");
        if (confirmCreate) {
            for (const { path, note } of creatableNotes) {
                const printableNote = getPrintableNoteContent(note);
                logger.info({ note: printableNote, path }, 'Will create note');

                if (should_confirm) {
                    const confirmed = await confirm(logger, `Create note ${note.title}`);

                    if (!confirmed) {
                        logger.info({ title: note.title, path }, 'Skipping note creation');
                        continue;
                    }
                }

                const createdNote = await tt.notes.createNote(note);
                await saveNoteToFs(createdNote, { dir, path: path, confirmOverwrite: false, shouldLog: true });
            }
        }
    } else {
        logger.info("No notes to create");
    }

    // ========
    // Find remote notes that don't exist locally (download)
    // ========
    const notesToDownload = await findRemoteNotesToDownload(dir);

    if (notesToDownload.length > 0) {
        logger.info({ count: notesToDownload.length, titles: notesToDownload.map((note) => note.title) }, 'Found notes to download from server');

        const confirmDownload = await confirm(logger, "Download notes from server?");

        if (confirmDownload) {
            for (const note of notesToDownload) {
                await saveNoteToFs(note, { dir, confirmOverwrite: true, shouldLog: true });
            }
        }

    } else {
        logger.info("No notes to download");
    }

    // ========
    // Find local notes whose ids don't exist on the server (recreate or delete)
    // ========
    const missingOnServer = await findLocalNotesMissingOnServer(dir);

    if (missingOnServer.length > 0) {
        logger.warn({ count: missingOnServer.length, titles: missingOnServer.map(({ note }) => note.title) }, 'Found local notes with ids that are missing on server');

        for (const { note, path } of missingOnServer) {
            logger.info({ title: note.title, id: note.id, path }, 'Local note id missing on server');
            const selectedOption = await pickOptionCli(logger, `How should be handle this?`, ['recreate', 'delete', 'skip']);
            switch (selectedOption) {
                case 'recreate':
                    const createdNote = await tt.notes.createNote({
                        title: note.title,
                        content: note.content,
                        date: note.date,
                        tags: note.tags ?? [],
                    });
                    await saveNoteToFs(createdNote, { dir, confirmOverwrite: false, shouldLog: true });
                    continue;
                case 'delete':
                    const confirmed = await confirm(logger, `Delete local file for "${note.title}"`);
                    if (confirmed) {
                        await unlink(path);
                        logger.info({ title: note.title, path }, 'Deleted local file for note missing on server');
                    } else {
                        logger.info({ title: note.title, path }, 'Skipped note missing on server');
                    }
                    continue;
                case 'skip':
                    logger.info({ title: note.title, path }, 'Skipped note missing on server');
                    continue;
            }
        }
    } else {
        logger.info('No local notes are missing on server');
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
        const doneEditingConfirm = await confirm(logger, "Press yes when you are done editing and ready to push changes to server")

        if (doneEditingConfirm) {
            // find conflicts again, for each conflict, ask the user if they want to push the changes to the server
            const conflicts = await findConflicts(dir);
            for (const conflict of conflicts) {
                logger.info({ title: conflict.remote.title }, 'Conflict remains after edit');
                logger.info({ conflictTypes: conflict.conflictType }, 'Conflict details');
                const confirmed = await confirm(logger, `Push changes to server for note ${conflict.remote.title}`);
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