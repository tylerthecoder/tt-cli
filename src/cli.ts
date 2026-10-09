#!/usr/bin/env bun
import { Command, Option } from 'commander';
import { loadEnvironment } from './environment.ts';
import { version } from '../package.json';

export function createProgram() {
    const program = new Command();
    program.name('tt').description("Tyler's Things CLI").version(version);
    program.hook('preAction', async () => {
        await loadEnvironment();
    });

    const notes = program.command('notes').description('Note operations');
    notes
        .command('list')
        .description('List all notes')
        .option('-p, --published', 'Show only published notes')
        .option('-t, --tag <tag>', 'Filter notes by tag')
        .option('-d, --date <date>', 'Filter notes by date')
        .addOption(
            new Option('-f, --format <format>', 'Output format')
                .choices(['text', 'json'])
                .default('text')
        )
        .action(async options => {
            const { getNotes, filterNotes, displayNotes } =
                await import('./notes.ts');
            const filtered = filterNotes(await getNotes(), options);
            displayNotes(filtered, options.format);
        });

    notes
        .command('sync')
        .description('Sync notes from the notes directory')
        .action(async () => {
            const { syncNotes } = await import('./parse-note.ts');
            await syncNotes();
        });

    notes
        .command('tui')
        .description(
            'Interactive TUI to browse, search, filter, and open notes'
        )
        .action(async () => {
            const { runNotesTui } = await import('./tui.tsx');
            await runNotesTui();
        });

    const note = program.command('note').description('Note operations');
    note.command('view')
        .description('View a note content by id')
        .argument('<id>')
        .action(async (id: string) => {
            const { getNoteById } = await import('./notes.ts');
            const n = await getNoteById(id);
            if (!n) throw new Error('Note not found');
            console.log(`# ${n.title}\n`);
            console.log(n.content || '');
        });

    note.command('open')
        .description('Open a note in the browser by id')
        .argument('<id>')
        .action(async (id: string) => {
            const { openNoteLink } = await import('./browser.ts');
            await openNoteLink(id);
        });

    program
        .command('agent')
        .description('Run the agent')
        .action(async () => {
            const { runAgent } = await import('./agent.ts');
            await runAgent();
        });
    return program;
}

export async function runCli(argv = process.argv, program = createProgram()) {
    try {
        await program.parseAsync(argv);
        return 0;
    } catch (error) {
        console.error(
            'Error:',
            error instanceof Error ? error.message : String(error)
        );
        return 1;
    }
}

if (import.meta.main) process.exit(await runCli());
