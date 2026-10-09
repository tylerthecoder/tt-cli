import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createConfigFile, makeScriptContent } from '../install.ts';

const roots: string[] = [];
afterEach(async () => {
    await Promise.all(
        roots.splice(0).map(path => rm(path, { recursive: true, force: true }))
    );
});

test('installer creates private configuration and preserves existing contents', async () => {
    const home = await mkdtemp(join(tmpdir(), 'tt-install-test-'));
    roots.push(home);
    await createConfigFile(home);
    const env = join(home, '.config', 'tt-cli', '.env');
    expect((await stat(env)).mode & 0o777).toBe(0o600);
    await Bun.write(env, 'EXAMPLE=preserved\n');
    await createConfigFile(home);
    expect(await Bun.file(env).text()).toBe('EXAMPLE=preserved\n');
});

test('wrapper quotes executable and script paths and preserves command arguments', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tt-wrapper-test-'));
    roots.push(root);
    const script = join(root, "path with 'quote $sign.ts");
    const wrapper = join(root, 'wrapper');
    await Bun.write(
        script,
        'console.log(JSON.stringify(process.argv.slice(2)));'
    );
    await Bun.write(wrapper, makeScriptContent(process.execPath, script));
    const proc = Bun.spawn(
        ['/bin/bash', wrapper, 'space argument', '$literal'],
        { stdout: 'pipe', stderr: 'pipe' }
    );
    expect(await proc.exited).toBe(0);
    expect(JSON.parse(await new Response(proc.stdout).text())).toEqual([
        'space argument',
        '$literal',
    ]);
    expect(await new Response(proc.stderr).text()).toBe('');
});
