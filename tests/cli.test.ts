import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const cli = resolve(import.meta.dir, '../src/cli.ts');
const directories: string[] = [];
afterEach(async () => {
    await Promise.all(
        directories
            .splice(0)
            .map(dir => rm(dir, { recursive: true, force: true }))
    );
});
async function isolatedCli(args: string[], opener?: string) {
    const dir = await mkdtemp(join(tmpdir(), 'tt-cli-test-'));
    directories.push(dir);
    if (opener) {
        await writeFile(
            join(dir, process.platform === 'darwin' ? 'open' : 'xdg-open'),
            `#!${process.execPath}\n${opener}\n`,
            { mode: 0o755 }
        );
    }
    const child = Bun.spawn([process.execPath, cli, ...args], {
        cwd: dir,
        env: { HOME: dir, PATH: dir },
        stdout: 'pipe',
        stderr: 'pipe',
    });
    const [code, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
    ]);
    return { code, stdout, stderr };
}

for (const args of [
    ['--help'],
    ['--version'],
    ['notes', 'list', '--help'],
    ['notes', 'sync', '--help'],
    ['note', 'open', '--help'],
]) {
    test(`${args.join(' ')} works without credentials or service initialization`, async () => {
        const result = await isolatedCli(args);
        expect(result.code).toBe(0);
        expect(result.stderr).toBe('');
        expect(result.stdout.length).toBeGreaterThan(0);
    });
}

test('invalid list format is rejected before service initialization', async () => {
    const result = await isolatedCli(['notes', 'list', '--format', 'xml']);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('Allowed choices are text, json');
    expect(result.stderr).not.toContain('MONGODB');
});

test('browser failure is awaited and reported as a command failure', async () => {
    const result = await isolatedCli(
        ['note', 'open', 'example'],
        'await Bun.sleep(20); process.exit(23);'
    );
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('Error:');
});

test('note open passes encoded IDs as a single URL argument', async () => {
    const result = await isolatedCli(
        ['note', 'open', 'a/b ?#;$(echo injected)'],
        `if (process.argv.length !== 3 || process.argv[2] !== 'https://tylertracy.com/notes/a%2Fb%20%3F%23%3B%24(echo%20injected)') process.exit(24);`
    );
    expect(result.code).toBe(0);
    expect(result.stderr).toBe('');
});
