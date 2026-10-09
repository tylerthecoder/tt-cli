import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export function browserCommand(url: string, platform = process.platform) {
    if (platform === 'darwin') return ['open', url] as const;
    if (platform === 'linux') return ['xdg-open', url] as const;
    throw new Error(`Opening a browser is not supported on ${platform}`);
}

export async function openLink(
    url: string,
    options: {
        platform?: NodeJS.Platform;
        launch?: (command: string, args: string[]) => Promise<unknown>;
    } = {}
) {
    const [command, argument] = browserCommand(url, options.platform);
    await (options.launch ?? execFileAsync)(command, [argument]);
}

export async function openNoteLink(id: string) {
    await openLink(`https://tylertracy.com/notes/${encodeURIComponent(id)}`);
}

export async function openGoogleDocLink(id: string) {
    await openLink(
        `https://docs.google.com/document/d/${encodeURIComponent(id)}`
    );
}
