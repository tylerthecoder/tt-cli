export function clampSelection(index: number, length: number): number {
    return Math.max(0, Math.min(index, length - 1));
}

export function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

export async function runPager(
    content: string,
    start = (input: Blob): Pick<Bun.Subprocess, 'exited' | 'signalCode'> =>
        Bun.spawn(['less', '-R'], {
            stdin: input,
            stdout: 'inherit',
            stderr: 'inherit',
        })
): Promise<void> {
    // Bun feeds stdin and closes it, including when the pager quits early.
    const pager = start(new Blob([content]));
    const code = await pager.exited;
    if (code !== 0) {
        throw new Error(
            `Pager exited with ${pager.signalCode || `status ${code}`}.`
        );
    }
}
