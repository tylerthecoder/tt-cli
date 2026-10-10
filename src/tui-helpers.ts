export function clampSelection(index: number, length: number): number {
    return Math.max(0, Math.min(index, length - 1));
}

export function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

export async function runPager(content: string): Promise<void> {
    const pager = Bun.spawn(['less', '-R'], {
        stdin: new Blob([content]),
        stdout: 'inherit',
        stderr: 'inherit',
    });
    const code = await pager.exited;
    if (code !== 0) {
        throw new Error(
            `Pager exited with ${pager.signalCode || `status ${code}`}.`
        );
    }
}
