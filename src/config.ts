import { join } from 'path';
import { homedir } from 'os';
import { config as dotenvConfig } from 'dotenv';
import { mkdir, readFile, writeFile } from 'fs/promises';

export async function loadSettings(home = homedir()) {
    const configDir = join(home, '.config', 'tt-cli');
    const settingsPath = join(configDir, 'settings.json');
    await mkdir(configDir, { recursive: true });

    // Exclusive creation preserves settings if another invocation starts first.
    try {
        await writeFile(settingsPath, '{}\n', { flag: 'wx', mode: 0o600 });
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }

    let settings: unknown;
    try {
        settings = JSON.parse(await readFile(settingsPath, 'utf8'));
    } catch {
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

const configDir = join(homedir(), '.config', 'tt-cli');
// Keep stdout available for command output, including JSON.
dotenvConfig({ path: join(configDir, '.env'), quiet: true });
export const NOTES_DIR = (await loadSettings()).notes_dir;
