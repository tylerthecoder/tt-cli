import { spawn, type ChildProcess } from 'node:child_process';

export function clampSelection(index: number, length: number): number {
    return Math.max(0, Math.min(index, length - 1));
}

export function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

// A pager may exit before consuming all of stdin (for example, when q is pressed).
export async function runPager(
    content: string,
    start: () => ChildProcess = () =>
        spawn('less', ['-R'], { stdio: ['pipe', 'inherit', 'inherit'] })
): Promise<void> {
    await new Promise<void>((resolve, reject) => {
        const pager = start();
        pager.once('error', reject);
        pager.once('close', (code, signal) => {
            if (code === 0) resolve();
            else
                reject(
                    new Error(
                        `Pager exited with ${signal || `status ${code}`}.`
                    )
                );
        });
        pager.stdin?.on('error', (error: NodeJS.ErrnoException) => {
            if (error.code !== 'EPIPE') reject(error);
        });
        pager.stdin?.end(content);
    });
}
