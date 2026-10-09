import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('Bun cache I/O creates directories, reuses fresh data, and refreshes stale or corrupt data', async () => {
    const home = await mkdtemp(join(tmpdir(), 'tt-cache-'));
    try {
        const child = Bun.spawn(
            [
                process.execPath,
                join(import.meta.dir, 'fixtures/cache-scenario.ts'),
            ],
            {
                env: { HOME: home, PATH: process.env.PATH },
                stdout: 'pipe',
                stderr: 'pipe',
            }
        );
        const [code, out, err] = await Promise.all([
            child.exited,
            new Response(child.stdout).text(),
            new Response(child.stderr).text(),
        ]);
        expect(err).toBe('');
        expect(code).toBe(0);
        expect(out).toContain('Cache scenario passed');
    } finally {
        await rm(home, { recursive: true, force: true });
    }
});
