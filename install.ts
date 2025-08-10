#!/usr/bin/env bun
import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

async function ensureDirectory(path: string) {
    try {
        await mkdir(path, { recursive: true });
    } catch (error) {
        if ((error as any).code !== 'EEXIST') {
            throw error;
        }
    }
}

async function createConfigFile() {
    const configDir = join(homedir(), '.config', 'tt-cli');
    const envPath = join(configDir, '.env');

    await ensureDirectory(configDir);

    // Create default .env if it doesn't exist
    try {
        await writeFile(envPath, '# TT-CLI Configuration\n', { flag: 'wx' });
        console.log('Created config file at:', envPath);
    } catch (error) {
        if ((error as any).code !== 'EEXIST') {
            throw error;
        }
        console.log('Config file already exists at:', envPath);
    }
}

async function install() {
    try {
        // Create config directory and file
        await createConfigFile();

        // Build the project
        console.log('Building project...');
        await execAsync('bun build ./src/cli.ts --compile --outfile tt');

        // Make the binary executable
        await execAsync('chmod +x tt');

        // Install to /usr/local/bin using sudo
        const binPath = '/usr/local/bin';
        console.log('Moving binary to /usr/local/bin (requires sudo)...');

        try {
            await execAsync(`sudo mv tt ${join(binPath, 'tt')}`);
        } catch (error) {
            console.error('Failed to move binary to /usr/local/bin. Do you have sudo access?');
            console.error('You can try running the move command manually:');
            console.error(`sudo mv tt ${join(binPath, 'tt')}`);
            process.exit(1);
        }

        console.log(`\nInstallation complete! The 'tt' command is now available.`);
        console.log(`Binary installed to: ${join(binPath, 'tt')}`);
    } catch (error) {
        console.error('Installation failed:', error);
        process.exit(1);
    }
}

install();