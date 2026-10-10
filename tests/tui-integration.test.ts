import { expect, test } from 'bun:test';
import { resolve } from 'node:path';

for (const exitKey of [
    'q',
    'ctrl-c',
    'busy-only',
    'error-q-search',
    'error-q-tag',
]) {
    const description = exitKey.startsWith('error-q')
        ? `TUI keeps q available after ${exitKey.endsWith('tag') ? 't' : '/'} on an initial error screen`
        : `TUI retries failures, consumes busy input, hands off pager input, and restores terminal on ${exitKey}`;
    test(
        description,
        async () => {
            const child = Bun.spawn(
                [
                    process.execPath,
                    resolve(import.meta.dir, 'fixtures/tui-scenario.ts'),
                    exitKey,
                ],
                {
                    env: { PATH: process.env.PATH, TERM: 'xterm-256color' },
                    stdout: 'pipe',
                    stderr: 'pipe',
                }
            );
            const timeout = setTimeout(() => child.kill(), 10000);
            try {
                const [code, stdout, stderr] = await Promise.all([
                    child.exited,
                    new Response(child.stdout).text(),
                    new Response(child.stderr).text(),
                ]);
                expect(stderr).toBe('');
                expect(code).toBe(0);
                expect(stdout).toContain('TUI scenario passed');
            } finally {
                clearTimeout(timeout);
                child.kill();
            }
        },
        15000
    );
}
