import { expect, test } from 'bun:test';
import { resolve } from 'node:path';

test('Bun note file IO supports explicit directories, collisions, updates, and overwrite refusal', async () => {
    const child = Bun.spawn(
        [
            process.execPath,
            resolve(import.meta.dir, 'fixtures/parse-note-scenario.ts'),
        ],
        {
            env: { PATH: process.env.PATH },
            stdout: 'pipe',
            stderr: 'pipe',
        }
    );
    const [code, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
    ]);
    expect(stderr).toBe('');
    expect(code).toBe(0);
    expect(stdout).toContain('Note filesystem scenario passed');
});
