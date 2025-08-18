import path, { join } from 'path';
import type { NoteType, Note } from '@tt-services';
import * as yaml from 'js-yaml';
import {
    readdir,
    readFile,
    writeFile,
    stat,
    exists,
    unlink,
} from 'fs/promises';
import type {
    CreatableNote,
    NoteMetadata,
} from '@tt-services/src/services/notes';
import {
    confirm,
    getTT,
    logger as baseLogger,
    pickOptionCli,
} from './utils.ts';
import { NOTES_DIR } from './config.ts';
import { $ } from 'bun';

const logger = baseLogger.child({
    module: 'parse-note',
    filename: import.meta.url,
});

const requireNotesDir = (dir?: string) => {
    const notesDir = dir ?? NOTES_DIR;
    if (!notesDir) {
        logger.error({ dirCandidate: dir }, 'Notes directory not set');
        process.exit(1);
    }
    return notesDir;
};

export const getPrintableNoteContent = (note: NoteType | CreatableNote) => {
    return Object.fromEntries(
        Object.entries(note).filter(
            ([key]) => key !== 'content' && key !== 'googleDocContent'
        )
    );
};

export async function generateNoteFilename(
    noteMetadata: NoteMetadata,
    notesDir?: string
): Promise<string> {
    let safeTitle = noteMetadata.title
        .toLowerCase()
        .replace(/[^a-z0-9_.\-]+/g, '-') // Allow underscore, dot, hyphen
        .replace(/-+/g, '-')
        .replace(/^-+|-+$/g, '');

    notesDir = requireNotesDir(notesDir);

    while (true) {
        const notePath = path.join(notesDir, `${safeTitle}.md`);
        if (!(await exists(notePath))) {
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

    return ['---', fmString.trim(), '---', note.content].join('\n');
}

export async function saveNoteToFs(
    note: NoteType,
    opts: {
        dir?: string;
        path?: string;
        confirmOverwrite?: boolean;
        shouldLog?: boolean;
    } = { dir: undefined, confirmOverwrite: false, shouldLog: true }
) {
    const filename = await generateNoteFilename(note);
    const content = formatNoteAsMarkdown(note);
    const notesDir = requireNotesDir(opts.dir);

    const allLocalNotes = await scanNotesDirectory(notesDir);
    const existingNote = allLocalNotes.find(
        ({ note: localNote }) => localNote.id === note.id
    );

    if (existingNote) {
        logger.info(
            { noteToSave: note, existingNote },
            'Note already exists locally'
        );
    }

    if (opts.path && existingNote) {
        logger.error(
            { noteToSave: note, existingNote },
            'Path provided but note already exists locally'
        );
        throw new Error('Path provided but note already exists locally');
    }

    const filePath =
        opts.path ??
        (existingNote ? existingNote.path : path.join(notesDir, filename));

    const confirmOverwrite = opts.confirmOverwrite ?? false;
    if (confirmOverwrite && (await exists(filePath))) {
        const confirmed = await confirm(
            logger,
            `Note already exists locally at ${filePath}, overwrite?`
        );
        if (!confirmed) {
            logger.info({ title: note.title, path: filePath }, 'Skipping note');
            return;
        }
    }
    await writeFile(filePath, content);
    if (opts.shouldLog ?? true) {
        logger.info(
            { title: note.title, path: filePath, id: note.id },
            'Saved note to file system'
        );
    }
}

export type NoteFile = {
    content: string;
    path: string;
};

export async function extractFrontmatterFromMarkdownFile(
    file: NoteFile
): Promise<Record<string, any> | null> {
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

export async function extractNoteFromMarkdownFile(
    file: NoteFile
): Promise<NoteType | null> {
    const frontmatter = await extractFrontmatterFromMarkdownFile(file);

    if (!frontmatter) {
        logger.warn(
            { path: file.path },
            'Note file has no frontmatter, skipping'
        );
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
        logger.warn(
            { path: file.path, id },
            'Note file has no createdAt, skipping'
        );
        return null;
    }

    const updatedAt = frontmatter?.updatedAt ?? null;
    if (!updatedAt) {
        logger.warn(
            { path: file.path, id },
            'Note file has no updatedAt, skipping'
        );
        return null;
    }

    const title = frontmatter?.title ?? null;
    if (!title) {
        logger.warn(
            { path: file.path, id },
            'Note file has no title, skipping'
        );
        return null;
    }

    const published = frontmatter?.published ?? false;

    const tags = frontmatter?.tags ?? null;

    const extraData = Object.fromEntries(
        Object.entries(frontmatter).filter(
            ([key]) =>
                key !== 'id' &&
                key !== 'createdAt' &&
                key !== 'updatedAt' &&
                key !== 'tags' &&
                key !== 'published'
        )
    );

    return {
        id,
        title,
        content,
        createdAt,
        updatedAt,
        tags,
        date: createdAt,
        published,
        ...extraData,
    };
}

// Only return notes that aren't in the system
export async function extractCreatableNoteFromMarkdownFile(
    file: NoteFile
): Promise<CreatableNote | null> {
    const frontmatter = await extractFrontmatterFromMarkdownFile(file);

    const id = frontmatter?.id ?? null;
    // Note already exists, skip
    if (id) {
        return null;
    }

    const title =
        typeof frontmatter?.title === 'string'
            ? frontmatter.title
            : file.path.split('/').pop()?.split('.').shift();
    if (!title) {
        logger.warn({ path: file.path }, 'Note file has no title, skipping');
        return null;
    }

    const date =
        typeof frontmatter?.date === 'string'
            ? frontmatter.date
            : (await stat(file.path)).mtime.toISOString();
    if (!date) {
        logger.warn(
            { path: file.path, title },
            'Note file has no date, skipping'
        );
        return null;
    }

    const tags = frontmatter?.tags ?? [];

    const content = removeFrontmatterFromMarkdownFile(file);

    return {
        title: title,
        content: content,
        date: date,
        tags: tags,
    };
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

    return files
        .filter(f => f.toLowerCase().endsWith('.md'))
        .map(f => join(dir, f));
}

export async function scanNotesDirectory(notesDir?: string) {
    notesDir = requireNotesDir(notesDir);

    const files = await getNoteFilePaths(notesDir);

    const notes: { note: NoteType; path: string }[] = [];

    for (const filePath of files) {
        const content = await readFile(filePath, 'utf8');
        const note = await extractNoteFromMarkdownFile({
            content,
            path: filePath,
        });

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

    const creatableNotes: { path: string; note: CreatableNote }[] = [];

    for (const filePath of files) {
        const note = await extractCreatableNoteFromMarkdownFile({
            content: await readFile(filePath, 'utf8'),
            path: filePath,
        });
        if (note) {
            creatableNotes.push({ path: filePath, note: note });
        }
    }

    return creatableNotes;
}

export async function findLocalNotesMissingOnServer(
    dir?: string
): Promise<Array<{ note: NoteType; path: string }>> {
    dir = requireNotesDir(dir);
    const notes = await scanNotesDirectory(dir);

    const tt = await getTT();
    const remoteNotes = await tt.notes.getAllNotesMetadata();

    const notesMissingOnServer: Array<{ note: NoteType; path: string }> = [];

    for (const { note, path } of notes) {
        if (remoteNotes.some(remoteNote => remoteNote.id === note.id)) {
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
    local: { note: NoteType; path: string };
    remote: Note;
    conflictType: Array<string>;
};

async function getNotesDirHasGitChanges() {
    const dir = requireNotesDir();
    const { stdout } = await $`git -C ${dir} status --porcelain`.quiet();
    return stdout.toString().trim().length > 0;

}

async function getNotesDirShortStatus() {
    const dir = requireNotesDir();
    const { stdout } = await $`git -C ${dir} status --short`.quiet();
    return stdout.toString().trim();
}

async function handleGitChanges() {
    const dir = requireNotesDir();

    while (await getNotesDirHasGitChanges()) {
        const shortStatus = await getNotesDirShortStatus();
        const resolutionOption = await pickOptionCli(
            logger,
            `Changes:\n${shortStatus}\n\nHow should we handle the git changes?`,
            ['commit', 'lazygit', 'recheck', 'exit']
        );
        switch (resolutionOption) {
            case 'commit':
                try {
                    await $`git -C ${dir} add .`.quiet();
                    await $`git -C ${dir} commit -m "Sync notes"`.quiet();
                } catch (e) {
                    logger.error({ error: e }, 'Error committing changes');
                    process.exit(1);
                }
                break;
            case 'lazygit':
                await $`terminator --role floating -e "lazygit -p ${dir}"`.quiet();
                console.log('lazygit done');
                break;
            case 'recheck':
                continue;
            case 'exit':
                logger.info('Exiting');
                process.exit(0);
        }
    }

    logger.info('Git changes handled');
}

async function handleConflict() {
    const notesDir = requireNotesDir();
    const tt = await getTT();

    await handleGitChanges();

    // loop over every server file and write its contents locally
    const remoteNotes = await tt.notes.getAllNotes();

    async function findConflicts() {
        const localFiles = await scanNotesDirectory(notesDir);
        const conflicts: Conflict[] = [];

        for (const { note, path } of localFiles) {
            const remoteNote = remoteNotes.find(
                remoteNote => remoteNote.id === note.id
            );
            if (!remoteNote) {
                logger.warn({ note }, 'Note not found on server, ');
                process.exit(1);
            }

            let conflictType: Array<string> = [];
            if (remoteNote.title !== note.title) {
                conflictType.push('title');
            }
            if (remoteNote.date !== note.date) {
                conflictType.push('date');
            }
            if (
                JSON.stringify(remoteNote.tags ?? []) !==
                JSON.stringify(note.tags ?? [])
            ) {
                conflictType.push('tags');
            }
            const localContentNoFrontmatter = removeFrontmatterFromMarkdownFile(
                {
                    content: note.content,
                    path: path,
                }
            );
            if (localContentNoFrontmatter !== remoteNote.content) {
                conflictType.push('content');
            }

            // Check if any of the other keys are different
            const otherKeys = Object.keys(note).filter(
                key =>
                    key !== 'id' &&
                    key !== 'title' &&
                    key !== 'date' &&
                    key !== 'tags' &&
                    key !== 'content'
            );
            for (const key of otherKeys) {
                if (remoteNote[key as keyof Note] !== note[key as keyof Note]) {
                    conflictType.push(key);
                }
            }

            if (conflictType.length > 0) {
                conflicts.push({
                    local: { note, path },
                    remote: remoteNote,
                    conflictType: conflictType,
                });
            }
        }

        return conflicts;
    }

    // ========
    // Find conflicts between local and remote notes
    // ========
    let conflicts = await findConflicts();

    // Save all remote notes to the local filesystem
    for (const conflict of conflicts) {
        await saveNoteToFs(conflict.remote, {
            confirmOverwrite: false,
            shouldLog: true,
        });
    }

    // First, resolve all the git conflicts
    while (await getNotesDirHasGitChanges()) {
        const shortStatus = await getNotesDirShortStatus();
        const conflictResolutionOption = await pickOptionCli(
            logger,
            `Conflicts:\n${shortStatus}\n\nHow should we handle the conflicts?`,
            ['lazygit', 'recheck', 'exit']
        );

        switch (conflictResolutionOption) {
            case 'lazygit':
                await $`terminator --role floating -e "lazygit -p ${notesDir}"`.quiet();
                console.log('lazygit done');
                break;
            case 'recheck':
                continue;
            case 'exit':
                logger.info('Exiting');
                process.exit(0);
        }
    }

    // There is a potential bug here where if the server files have changed we might overwrite them.

    conflicts = await findConflicts();

    if (conflicts.length === 0) {
        logger.info('No conflicts found');
        return;
    }

    // Then, push the changes to the server
    logger.info('Pushing changes to server');

    for (const conflict of conflicts) {
        logger.info({ conflict }, 'Pushing changes to server');
        const confirmPush = await confirm(
            logger,
            `Push changes to server for note ${conflict.remote.title}?`
        );
        if (confirmPush) {
            await tt.notes.updateNote(
                conflict.remote.id,
                conflict.local.note
            );
        }
    }

    logger.info('Conflicts resolved');
}

/* This function will ensure that every file in the notes directory is tracked by the server.
It doesn't handle conflicts, it just ensures that every file is tracked by the server.
**/
async function ensureAllFilesAreTracked() {
    const notesDir = requireNotesDir();
    const files = await getNoteFilePaths(notesDir);

    const tt = await getTT();
    const remoteNotes = await tt.notes.getAllNotes();
    const remoteIds = new Set(remoteNotes.map(note => note.id));

    const localIdToPath = new Map<string, string>();

    for (const filePath of files) {
        const content = await readFile(filePath, 'utf8');
        let note = await extractNoteFromMarkdownFile({
            content,
            path: filePath,
        });

        if (!note) {
            // Note not in system, creating it...
            const creatableNote = await extractCreatableNoteFromMarkdownFile({
                content,
                path: filePath,
            });

            if (!creatableNote) {
                logger.warn(
                    { filePath },
                    'Note not in system and not creatable, exiting'
                );
                process.exit(1);
            }

            const confirmCreate = await confirm(
                logger,
                `Create note ${creatableNote.title}?`
            );
            if (!confirmCreate) {
                logger.info('Exiting');
                process.exit(0);
            }

            const createdNote = await tt.notes.createNote(creatableNote);
            await saveNoteToFs(createdNote, {
                dir: notesDir,
                confirmOverwrite: false,
                shouldLog: true,
            });
            note = createdNote;
        }

        if (!remoteIds.has(note.id)) {
            // note has id that isn't in the server. We either need to create it or delete it.
            const option = await pickOptionCli(
                logger,
                `Note ${note.title} has id ${note.id} that isn't in the server. How should we handle it?`,
                ['create', 'delete', 'exit']
            );

            if (option === 'create') {
                logger.info({ note }, 'Creating note');
                const createdNote = await tt.notes.createNote({
                    title: note.title,
                    content: note.content,
                    date: note.date,
                    tags: note.tags ?? [],
                });
                await saveNoteToFs(createdNote, {
                    dir: notesDir,
                    confirmOverwrite: false,
                    shouldLog: true,
                });
                note = createdNote;
            } else if (option === 'delete') {
                logger.info({ note }, 'Deleting note');
                await unlink(filePath);
                continue;
            } else {
                logger.info('Exiting');
                process.exit(0);
            }
        }

        const duplicatePath = localIdToPath.get(note.id);

        if (duplicatePath) {
            const option = await pickOptionCli(
                logger,
                `Note ${note.title} has id ${note.id} that is already in the system. How should we handle it?`,
                [`delete ${duplicatePath}`, `delete ${filePath}`, 'exit']
            );

            if (option === `delete ${duplicatePath}`) {
                logger.info({ note }, 'Deleting note');
                await unlink(duplicatePath);
            } else if (option === `delete ${filePath}`) {
                logger.info({ note }, 'Deleting note');
                await unlink(filePath);
            } else {
                logger.info('Exiting');
                process.exit(0);
            }
        }

        localIdToPath.set(note.id, filePath);
    }

    logger.info('All files are tracked');
}

export async function syncNotes(dir?: string, should_confirm: boolean = true) {
    dir = requireNotesDir(dir);
    const tt = await getTT();

    // ========
    // Check for git changes. If there are changes, ask the user if they want to commit them.
    // ========
    await handleGitChanges();

    // ========
    // Ensure all files are tracked
    // ========
    await ensureAllFilesAreTracked();

    // ========
    // Find remote notes that don't exist locally (download)
    // ========
    const notesToDownload = await findRemoteNotesToDownload(dir);

    if (notesToDownload.length > 0) {
        logger.info(
            {
                count: notesToDownload.length,
                titles: notesToDownload.map(note => note.title),
            },
            'Found notes to download from server'
        );

        const confirmDownload = await confirm(
            logger,
            'Download notes from server?'
        );

        if (confirmDownload) {
            for (const note of notesToDownload) {
                await saveNoteToFs(note, {
                    dir,
                    confirmOverwrite: true,
                    shouldLog: true,
                });
            }
        }
    } else {
        logger.info('No notes to download');
    }

    await handleConflict();

    logger.info('Sync complete 🤸');

    await tt.disconnect();
}
