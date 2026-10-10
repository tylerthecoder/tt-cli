import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { existsSync } from 'node:fs';
import { join } from 'path';

const homes: string[] = [];
afterEach(async () => {
    await Promise.all(
        homes.splice(0).map(home => rm(home, { recursive: true, force: true }))
    );
});

async function runConfig(settings?: string) {
    const home = await mkdtemp(join(tmpdir(), 'tt-config-'));
    homes.push(home);
    const dir = join(home, '.config', 'tt-cli');
    if (settings !== undefined) {
        await mkdir(dir, { recursive: true });
        await writeFile(join(dir, 'settings.json'), settings);
    }
    const proc = Bun.spawn(
        [
            process.execPath,
            '-e',
            `import { NOTES_DIR } from './src/config.ts'; console.log(JSON.stringify({notes_dir: NOTES_DIR}));`,
        ],
        {
            cwd: join(import.meta.dir, '..'),
            env: { PATH: process.env.PATH, HOME: home },
            stdout: 'pipe',
            stderr: 'pipe',
        }
    );
    const [stdout, stderr, code] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
    ]);
    return { home, dir, stdout, stderr, code };
}

test('missing settings return defaults without creating files', async () => {
    const result = await runConfig();
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({});
    expect(existsSync(result.dir)).toBe(false);
});

test('expands documented home-relative notes directory and preserves settings', async () => {
    const settings = '{"notes_dir":"~/Documents/Notes", "custom":true}';
    const result = await runConfig(settings);
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout).notes_dir).toBe(
        join(result.home, 'Documents/Notes')
    );
    expect(await readFile(join(result.dir, 'settings.json'), 'utf8')).toBe(
        settings
    );
});

for (const settings of [
    '{',
    'null',
    '[]',
    '{"notes_dir":42}',
    '{"notes_dir":" "}',
]) {
    test(`invalid settings produce an actionable error: ${settings}`, async () => {
        const result = await runConfig(settings);
        expect(result.code).toBe(1);
        expect(result.stderr).toContain(join(result.dir, 'settings.json'));
        expect(result.stdout).toBe('');
        expect(await readFile(join(result.dir, 'settings.json'), 'utf8')).toBe(
            settings
        );
    });
}
