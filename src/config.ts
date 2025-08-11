import { join } from 'path';
import { homedir } from 'os';
import { config as dotenv_config } from 'dotenv';
import { mkdir } from 'fs/promises';
import { z } from 'zod';
import { colors } from './utils.ts';

async function ensureDir(path: string) {
  if (!Bun.file(path).exists()) {
    await mkdir(path, { recursive: true });
  }
}

const configDir = join(homedir(), '.config', 'tt-cli');
await ensureDir(configDir);
const envPath = join(configDir, '.env');
if (await Bun.file(envPath).exists()) {
  console.log(colors.yellow, "Loading .env file from ", envPath, colors.reset);
  dotenv_config({ path: envPath });
}

const settingsPath = join(configDir, 'settings.json');
const settingsExists = await Bun.file(settingsPath).exists();
if (!settingsExists) {
  console.log(colors.yellow, "No settings file found, creating default settings", colors.reset);
  await Bun.write(settingsPath, JSON.stringify({}));
}

const settings = JSON.parse(await Bun.file(settingsPath).text());

const zodSettings = z.object({
  notes_dir: z.string().optional(),
});
const parsedSettings = zodSettings.parse(settings);

export const NOTES_DIR = parsedSettings.notes_dir;
