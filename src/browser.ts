async function openLink(url: string) {
    const command = process.platform === 'darwin' ? 'open' : 'xdg-open';
    const child = Bun.spawn([command, url], {
        stdin: 'ignore',
        stdout: 'ignore',
        stderr: 'pipe',
    });
    const [code, stderr] = await Promise.all([
        child.exited,
        new Response(child.stderr).text(),
    ]);
    if (code !== 0) {
        throw new Error(`${command} failed (${code}): ${stderr.trim()}`);
    }
}

export async function openNoteLink(id: string) {
    await openLink(`https://tylertracy.com/notes/${encodeURIComponent(id)}`);
}

export async function openGoogleDocLink(id: string) {
    await openLink(
        `https://docs.google.com/document/d/${encodeURIComponent(id)}`
    );
}
