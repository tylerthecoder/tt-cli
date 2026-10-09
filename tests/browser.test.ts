import { expect, test } from 'bun:test';
import { browserCommand, openLink } from '../src/browser.ts';

test('selects the native browser opener on macOS and Linux', () => {
    expect(browserCommand('https://example.com', 'darwin')).toEqual([
        'open',
        'https://example.com',
    ]);
    expect(browserCommand('https://example.com', 'linux')).toEqual([
        'xdg-open',
        'https://example.com',
    ]);
    expect(() => browserCommand('https://example.com', 'win32')).toThrow(
        'not supported on win32'
    );
});

test('browser launch uses an argument array and awaits completion', async () => {
    const calls: unknown[] = [];
    let completed = false;
    await openLink('https://example.com/a?x=1&y=2', {
        platform: 'darwin',
        launch: async (command, args) => {
            calls.push([command, args]);
            await Bun.sleep(10);
            completed = true;
        },
    });
    expect(calls).toEqual([['open', ['https://example.com/a?x=1&y=2']]]);
    expect(completed).toBe(true);
});

test('browser launch errors propagate to the caller', async () => {
    await expect(
        openLink('https://example.com', {
            platform: 'linux',
            launch: async () => {
                throw new Error('browser unavailable');
            },
        })
    ).rejects.toThrow('browser unavailable');
});
