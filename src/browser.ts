async function launchBrowser(command: string, args: string[]) {
    const child = Bun.spawn([command, ...args], {
        stdin: 'ignore',
        stdout: 'ignore',
        stderr: 'pipe',
    });
    const [code, stderr] = await Promise.all([
        child.exited,
        new Response(child.stderr).text(),
    ]);
    if (code !== 0) {
        throw new Error(
            `${command} exited with ${child.signalCode || `status ${code}`}${stderr.trim() ? `: ${stderr.trim()}` : ''}`
        );
    }
}

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
    await (options.launch ?? launchBrowser)(command, [argument]);
}

export async function openNoteLink(id: string) {
    await openLink(`https://tylertracy.com/notes/${encodeURIComponent(id)}`);
}

export async function openGoogleDocLink(id: string) {
    await openLink(
        `https://docs.google.com/document/d/${encodeURIComponent(id)}`
    );
}
