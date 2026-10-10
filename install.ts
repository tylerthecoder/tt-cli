#!/usr/bin/env bun
import { join, dirname } from 'path';
import { homedir } from 'os';
import { $ } from 'bun';
import { writeFile } from 'node:fs/promises';

// Paths
const cliFilePath = join(dirname(import.meta.path), 'src', 'cli.ts');
const tempScriptPath = join(dirname(import.meta.path), 'tt');
const binPath = '/usr/local/bin/tt';

function shellQuote(value: string) {
    return "'" + value.replaceAll("'", "'\\''") + "'";
}

function makeScriptContent(): string {
    return `#!/usr/bin/env bash\nset -euo pipefail\nexec ${shellQuote(process.execPath)} --env-file="$HOME/.config/tt-cli/.env" ${shellQuote(cliFilePath)} "$@"\n`;
}

async function createConfigFile() {
    const configDir = join(homedir(), '.config', 'tt-cli');
    const envPath = join(configDir, '.env');
    await $`mkdir -p ${configDir}`.quiet();
    // Keep credential files private; exclusive creation prevents overwrites.
    try {
        await writeFile(envPath, '# TT-CLI Configuration\n', {
            flag: 'wx',
            mode: 0o600,
        });
        console.log('Created config file at:', envPath);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
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

if (import.meta.main) await install();
