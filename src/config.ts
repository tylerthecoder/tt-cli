import { join } from 'path';
import { homedir } from 'os';

const home = homedir();
const settingsPath = join(home, '.config', 'tt-cli', 'settings.json');

async function loadSettings() {
    let settings: unknown;
    try {
        settings = await Bun.file(settingsPath).json();
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
        throw new Error(
            `Cannot read settings at ${settingsPath}. Expected valid JSON.`
        );
    }
    if (
        !settings ||
        typeof settings !== 'object' ||
        Array.isArray(settings) ||
        ('notes_dir' in settings &&
            (typeof settings.notes_dir !== 'string' ||
                !settings.notes_dir.trim()))
    ) {
        throw new Error(
            `Invalid settings at ${settingsPath}: notes_dir must be a non-empty string.`
        );
    }
    const notesDir = (settings as { notes_dir?: string }).notes_dir;
    return {
        notes_dir:
            notesDir === '~'
                ? home
                : notesDir?.startsWith('~/')
                  ? join(home, notesDir.slice(2))
                  : notesDir,
    };
}

export const NOTES_DIR = (await loadSettings()).notes_dir;
