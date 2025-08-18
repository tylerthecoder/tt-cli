#!/usr/bin/env bun
import { join, dirname } from 'path';
import { homedir } from 'os';
import { $ } from 'bun';

// Paths
const cliFilePath = join(dirname(import.meta.path), 'src', 'cli.ts');
const tempScriptPath = join(dirname(import.meta.path), 'tt');
const binPath = '/usr/local/bin/tt';

function makeScriptContent(): string {
    const bunBinPath = Bun.which('bun');
    if (!bunBinPath) {
        throw new Error('Bun is not installed');
    }
    return `#!/usr/bin/env bash\nset -euo pipefail\nexec ${bunBinPath} run \"${cliFilePath}\" \"$@\"\n`;
}

async function ensureDirectory(path: string) {
    await $`mkdir -p ${path}`.quiet();
}

async function createConfigFile() {
    const configDir = join(homedir(), '.config', 'tt-cli');
    const envPath = join(configDir, '.env');

    await ensureDirectory(configDir);

    // Create default .env if it doesn't exist
    if (!(await Bun.file(envPath).exists())) {
        await Bun.write(envPath, '# TT-CLI Configuration\n');
        console.log('Created config file at:', envPath);
    } else {
        console.log('Config file already exists at:', envPath);
    }
}

async function install() {
    try {
        await createConfigFile();
        const scriptContent = makeScriptContent();

        await Bun.write(tempScriptPath, scriptContent);
        await $`chmod +x ${tempScriptPath}`.quiet();

        console.log(`Installing to ${binPath} (requires sudo)...`);

        try {
            await $`sudo mv ${tempScriptPath} ${binPath}`;
            await $`sudo chmod +x ${binPath}`;
        } catch (error) {
            console.error(
                'Failed to move wrapper to /usr/local/bin. Do you have sudo access?'
            );
            console.error('You can try running the move command manually:');
            console.error(`sudo mv ${tempScriptPath} ${binPath}`);
            console.error(`sudo chmod +x ${binPath}`);
            process.exit(1);
        }

        console.log(
            `\nInstallation complete! The 'tt' command is now available.`
        );
        console.log(`Wrapper installed to: ${binPath}`);
    } catch (error) {
        console.error('Installation failed:', error);
        process.exit(1);
    }
}

install();
