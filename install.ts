#!/usr/bin/env bun
import { mkdir, writeFile } from 'fs/promises';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';
import { fileURLToPath } from 'url';

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

        // Determine absolute project root from this installer location
        const projectRoot = dirname(fileURLToPath(new URL('.', import.meta.url)));
        const wrapperPath = join(projectRoot, 'tt');

        // Create a small wrapper that runs the CLI via bun from the project directory
        const wrapperContent = `#!/usr/bin/env bash\nset -euo pipefail\nPROJECT_ROOT=${projectRoot.replace(/\\/g, '\\\\')}\ncd \"$PROJECT_ROOT\"\nexec bun \"$PROJECT_ROOT/src/cli.ts\" \"$@\"\n`;

        await writeFile(wrapperPath, wrapperContent, { mode: 0o755 });

        // Install to /usr/local/bin using sudo
        const binPath = '/usr/local/bin';
        console.log('Moving wrapper to /usr/local/bin (requires sudo)...');

        try {
            await execAsync(`sudo mv ${wrapperPath} ${join(binPath, 'tt')}`);
            await execAsync(`sudo chmod +x ${join(binPath, 'tt')}`);
        } catch (error) {
            console.error('Failed to move wrapper to /usr/local/bin. Do you have sudo access?');
            console.error('You can try running the move command manually:');
            console.error(`sudo mv ${wrapperPath} ${join(binPath, 'tt')}`);
            console.error(`sudo chmod +x ${join(binPath, 'tt')}`);
            process.exit(1);
        }

        console.log(`\nInstallation complete! The 'tt' command is now available.`);
        console.log(`Wrapper installed to: ${join(binPath, 'tt')}`);
    } catch (error) {
        console.error('Installation failed:', error);
        process.exit(1);
    }
}

install();