import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadEnvironment } from '../src/environment.ts';

const roots: string[] = [];
afterEach(async () => {
    await Promise.all(
        roots.splice(0).map(path => rm(path, { recursive: true, force: true }))
    );
});
async function fixture(homeContents?: string, cwdContents?: string) {
    const root = await mkdtemp(join(tmpdir(), 'tt-env-test-'));
    roots.push(root);
    const home = join(root, 'home');
    const cwd = join(root, 'cwd');
    if (homeContents !== undefined)
        await Bun.write(join(home, '.config', 'tt-cli', '.env'), homeContents);
    if (cwdContents !== undefined)
        await Bun.write(join(cwd, '.env'), cwdContents);
    return { home, cwd };
}

test('home defaults preserve existing environment, including empty strings', async () => {
    const paths = await fixture(
        'EXISTING=file\nEMPTY=file\nNEW=default\n',
        'NEW=cwd\nCWD_ONLY=ignored\n'
    );
    const env: Record<string, string | undefined> = {
        EXISTING: 'exported',
        EMPTY: '',
    };
    await loadEnvironment({ ...paths, env });
    expect(env).toEqual({ EXISTING: 'exported', EMPTY: '', NEW: 'default' });
});

test('missing home env falls back to cwd; missing both is allowed', async () => {
    const paths = await fixture(undefined, 'LOCAL=value\n');
    const env: Record<string, string | undefined> = {};
    await loadEnvironment({ ...paths, env });
    expect(env).toEqual({ LOCAL: 'value' });
    await loadEnvironment({ ...(await fixture()), env });
    expect(env).toEqual({ LOCAL: 'value' });
});

test('native parser supports exports, quotes, comments, and multiline values', async () => {
    const paths = await fixture(
        'export PLAIN=value # comment\nQUOTED="a # b"\nMULTILINE="line one\nline two"\nLITERAL=\'$VALUE\'\n'
    );
    const env: Record<string, string | undefined> = {};
    await loadEnvironment({ ...paths, env });
    expect(env).toEqual({
        PLAIN: 'value',
        QUOTED: 'a # b',
        MULTILINE: 'line one\nline two',
        LITERAL: '$VALUE',
    });
});

test('empty home env still takes precedence over cwd fallback', async () => {
    const paths = await fixture('', 'CWD_ONLY=value\n');
    const env: Record<string, string | undefined> = {};
    await loadEnvironment({ ...paths, env });
    expect(env).toEqual({});
});

test('native env parsing preserves dotenv newline semantics', async () => {
    const paths = await fixture(String.raw`ESCAPED="line one\nline two"
CARRIAGE="line one\rline two"
UNQUOTED=line one\nline two
MULTILINE="line one
line two"
SINGLE='line one\nline two'
`);
    const env: Record<string, string | undefined> = {};
    await loadEnvironment({ ...paths, env });
    expect(env.ESCAPED).toBe('line one\nline two');
    expect(env.CARRIAGE).toBe('line one\rline two');
    expect(env.UNQUOTED).toBe(String.raw`line one\nline two`);
    expect(env.SINGLE).toBe(String.raw`line one\nline two`);
    expect(env.MULTILINE).toBe('line one\nline two');
});
