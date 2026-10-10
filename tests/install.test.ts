import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, rm, stat, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const roots: string[] = [];
afterEach(async () => {
    await Promise.all(
        roots.splice(0).map(path => rm(path, { recursive: true, force: true }))
    );
});

test('installer preserves config and launcher uses native env loading with quoted paths', async () => {
    const home = await mkdtemp(join(tmpdir(), "tt-install 'quoted $-"));
    roots.push(home);
    await Bun.write(
        join(home, 'install.ts'),
        Bun.file(join(import.meta.dir, '../install.ts'))
    );
    await Bun.write(
        join(home, 'src/cli.ts'),
        `console.log(JSON.stringify({args: process.argv.slice(2), value: Bun.env.EXAMPLE}));`
    );
    // Keep all installation effects in this fixture, never invoke real sudo.
    await Bun.write(
        join(home, 'sudo'),
        '#!/bin/bash\nif [ "$1" = mv ]; then /bin/mv "$2" "$HOME/tt-installed"; fi\n'
    );
    await chmod(join(home, 'sudo'), 0o755);
    const env = { HOME: home, PATH: `${home}:/usr/bin:/bin` };
    async function install() {
        const proc = Bun.spawn([process.execPath, join(home, 'install.ts')], {
            cwd: home,
            env,
            stdout: 'pipe',
            stderr: 'pipe',
        });
        const [code, stdout, stderr] = await Promise.all([
            proc.exited,
            new Response(proc.stdout).text(),
            new Response(proc.stderr).text(),
        ]);
        expect(code).toBe(0);
        expect(stderr).toBe('');
        expect(stdout).toContain('Installation complete');
    }
    await install();
    const envFile = join(home, '.config', 'tt-cli', '.env');
    expect((await stat(envFile)).mode & 0o777).toBe(0o600);
    await Bun.write(envFile, 'EXAMPLE=from-home\n');
    await install();
    expect(await Bun.file(envFile).text()).toBe('EXAMPLE=from-home\n');
    for (const exported of [undefined, 'exported']) {
        const proc = Bun.spawn(
            [
                '/bin/bash',
                join(home, 'tt-installed'),
                'space argument',
                '$literal',
            ],
            {
                cwd: home,
                env: { ...env, ...(exported ? { EXAMPLE: exported } : {}) },
                stdout: 'pipe',
                stderr: 'pipe',
            }
        );
        expect(await proc.exited).toBe(0);
        expect(JSON.parse(await new Response(proc.stdout).text())).toEqual({
            args: ['space argument', '$literal'],
            value: exported ?? 'from-home',
        });
        expect(await new Response(proc.stderr).text()).toBe('');
    }
});
