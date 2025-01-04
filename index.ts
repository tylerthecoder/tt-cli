#!/usr/bin/env bun
import { TylersThings } from '@tt-services';
import type { NoteMetadata as NoteType } from '@tt-services';
import { Command } from 'commander';
import { config } from 'dotenv';
import { join } from 'path';
import { homedir } from 'os';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';

// Try loading from .config/tt-cli/.env first, then fallback to local .env
const configPath = join(homedir(), '.config', 'tt-cli', '.env');
const result = config({ path: configPath });

if (result.error) {
  // If .config/tt-cli/.env fails, try local .env
  config();
}

const CACHE_DIR = join(homedir(), '.cache', 'tt-cli');
const NOTES_CACHE_FILE = join(CACHE_DIR, 'notes.json');
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes in milliseconds

interface CacheData {
  timestamp: number;
  notes: NoteType[];
}

async function ensureCacheDir() {
  if (!existsSync(CACHE_DIR)) {
    await mkdir(CACHE_DIR, { recursive: true });
  }
}

async function getNotes(): Promise<NoteType[]> {
  await ensureCacheDir();

  try {
    // Check if cache exists and is valid
    if (existsSync(NOTES_CACHE_FILE)) {
      const cacheContent = await readFile(NOTES_CACHE_FILE, 'utf-8');
      const cache: CacheData = JSON.parse(cacheContent);

      // Check if cache is still valid
      if (Date.now() - cache.timestamp <= CACHE_TTL) {
        return cache.notes;
      }
    }
  } catch (error) {
    console.error('Cache read error:', error);
  }

  // Cache doesn't exist, is invalid, or had an error - fetch new data
  const tt = await TylersThings.make();
  const notes = await tt.notes.getAllNotesMetadata();

  // Update cache
  try {
    const cacheData: CacheData = {
      timestamp: Date.now(),
      notes
    };
    await writeFile(NOTES_CACHE_FILE, JSON.stringify(cacheData, null, 2));
  } catch (error) {
    console.error('Cache write error:', error);
  }

  return notes;
}

async function filterNotes(notes: NoteType[], options: any): Promise<NoteType[]> {
  let filtered = [...notes];

  if (options.published) {
    filtered = filtered.filter(note => note.published);
  }

  if (options.tag) {
    filtered = filtered.filter(note => note.tags?.includes(options.tag));
  }

  if (options.date) {
    filtered = filtered.filter(note => note.date === options.date);
  }

  return filtered;
}

async function displayNotes(notes: NoteType[], format: string = 'text') {
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

const program = new Command();

program
  .name('tt')
  .description('Tyler\'s Things CLI')
  .version('1.0.0');

program
  .command('notes')
  .description('List all notes')
  .option('-p, --published', 'Show only published notes')
  .option('-t, --tag <tag>', 'Filter notes by tag')
  .option('-d, --date <date>', 'Filter notes by date')
  .option('-f, --format <format>', 'Output format (text or json)', 'text')
  .action(async (options) => {
    try {
      const notes = await getNotes();
      const filtered = await filterNotes(notes, options);
      await displayNotes(filtered, options.format);
      process.exit(0);
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : 'Unknown error');
      process.exit(1);
    }
  });

program
  .command('note')
  .description('Note operations')
  .command('open <id>')
  .description('Open a note in the browser')
  .action(async (id: string) => {
    try {
      const { exec } = await import('child_process');
      exec(`xdg-open https://omninote.tylertracy.com/notes/edit/${id}`);
      process.exit(0);
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : 'Unknown error');
      process.exit(1);
    }
  });

program.parse();