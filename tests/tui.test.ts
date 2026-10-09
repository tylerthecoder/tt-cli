import { describe, expect, test } from 'bun:test';
import { clampSelection, errorMessage, runPager } from '../src/tui-helpers.ts';

test('empty-list navigation never selects -1', () => {
    expect(clampSelection(1, 0)).toBe(0);
    expect(clampSelection(10, 0)).toBe(0);
    expect(clampSelection(-1, 5)).toBe(0);
    expect(clampSelection(10, 5)).toBe(4);
});

describe('Bun pager lifecycle', () => {
    test('sends complete UTF-8 content to a real subprocess and waits for it', async () => {
        const content = 'A note 📝\n' + 'body\n'.repeat(20000);
        let output: Promise<string> | undefined;
        await runPager(content, input => {
            const child = Bun.spawn(
                [
                    process.execPath,
                    '-e',
                    'await Bun.sleep(10); process.stdout.write(await Bun.stdin.text());',
                ],
                {
                    stdin: input,
                    stdout: 'pipe',
                    stderr: 'pipe',
                }
            );
            output = new Response(child.stdout).text();
            return child;
        });
        expect(await output).toBe(content);
    });

    test('reports missing pager', async () => {
        await expect(
            runPager('', input =>
                Bun.spawn(['/nonexistent/tt-cli-test-pager'], { stdin: input })
            )
        ).rejects.toThrow();
    });

    test('quitting before consuming stdin succeeds', async () => {
        await runPager('body'.repeat(1024 * 1024), input =>
            Bun.spawn([process.execPath, '-e', 'process.exit(0)'], {
                stdin: input,
                stdout: 'ignore',
                stderr: 'pipe',
            })
        );
    });

    test('reports unsuccessful exit', async () => {
        await expect(
            runPager('', input =>
                Bun.spawn([process.execPath, '-e', 'process.exit(7)'], {
                    stdin: input,
                    stdout: 'ignore',
                    stderr: 'pipe',
                })
            )
        ).rejects.toThrow('status 7');
    });
});

test('errors from arbitrary thrown values are readable', () => {
    expect(errorMessage(new Error('offline'))).toBe('offline');
    expect(errorMessage('offline')).toBe('offline');
});
