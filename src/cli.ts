#!/usr/bin/env bun
import { Command } from 'commander';
import { config } from 'dotenv';
import { join } from 'path';
import { homedir } from 'os';
import { getNotes as getNotesCached, filterNotes, displayNotes, getNoteById, openNoteLink } from './notes.ts';
import { syncNotes } from './parse-note.ts';
import { runAgent } from './agent.ts';

const configPath = join(homedir(), '.config', 'tt-cli', '.env');
const result = config({ path: configPath });

if (result.error) {
  config();
}

const program = new Command();

program
  .name('tt')
  .description('Tyler\'s Things CLI')
  .version('1.0.0');

const notes = program.command('notes').description('Note operations');

notes
  .command('list')
  .description('List all notes')
  .option('-p, --published', 'Show only published notes')
  .option('-t, --tag <tag>', 'Filter notes by tag')
  .option('-d, --date <date>', 'Filter notes by date')
  .option('-f, --format <format>', 'Output format (text or json)', 'text')
  .action(async (options) => {
    try {
      const notes = await getNotesCached();
      const filtered = filterNotes(notes, options);
      displayNotes(filtered, options.format);
      process.exit(0);
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : 'Unknown error' + error);
      process.exit(1);
    }
  });

notes
  .command('sync')
  .description('Sync notes from the notes directory')
  .action(async (options) => {
    await syncNotes(undefined, options.yes);
  });

notes
  .command('tui')
  .description('Interactive TUI to browse, search, and filter notes; prints selected note content and exits')
  .action(async () => {
    try {
      const { runNotesTui } = await import('./tui.tsx');
      await runNotesTui();
      process.exit(0);
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : 'Unknown error' + error);
      process.exit(1);
    }
  });

const note = program.command('note').description('Note operations');

note
  .command('view')
  .description('View a note content by id')
  .argument('<id>')
  .action(async (id: string) => {
    try {
      const n = await getNoteById(id);
      if (!n) {
        console.error('Note not found');
        process.exit(1);
      }
      console.log(`# ${n.title}\n`);
      console.log(n.content || '');
      process.exit(0);
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : 'Unknown error');
      process.exit(1);
    }
  });

note
  .command('open')
  .description('Open a note in the browser by id')
  .argument('<id>')
  .action(async (id: string) => {
    try {
      openNoteLink(id);
      process.exit(0);
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : 'Unknown error');
      process.exit(1);
    }
  });

program.command('agent')
  .description('Run the agent')
  .action(async () => {
    await runAgent();
  });

program.parse();