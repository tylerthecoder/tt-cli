import { expect, test } from 'bun:test';
import { resolve } from 'node:path';

for (const exitKey of ['q', 'ctrl-c']) {
    test(`TUI retries failures, hands off pager input, and restores terminal on ${exitKey}`, async () => {
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
    }, 15000);
}
