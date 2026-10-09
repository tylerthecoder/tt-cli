import { describe, expect, test } from 'bun:test';
import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { clampSelection, errorMessage, runPager } from '../src/tui-helpers.ts';

function fakePager() {
    const pager = new EventEmitter();
    const stdin = Object.assign(new EventEmitter(), {
        end(content: string) {
            contents = content;
        },
    });
    let contents = '';
    return {
        child: Object.assign(pager, { stdin }) as unknown as ChildProcess,
        pager,
        stdin,
        contents: () => contents,
    };
}

describe('TUI navigation', () => {
    test('moving down or paging on an empty list never selects -1', () => {
        expect(clampSelection(1, 0)).toBe(0);
        expect(clampSelection(10, 0)).toBe(0);
        expect(clampSelection(-1, 5)).toBe(0);
        expect(clampSelection(10, 5)).toBe(4);
    });
});

describe('pager lifecycle', () => {
    test('sends content and waits for close', async () => {
        const fake = fakePager();
        const promise = runPager('a note', () => fake.child);
        expect(fake.contents()).toBe('a note');
        fake.pager.emit('close', 0, null);
        await promise;
    });

    test('reports missing pager instead of leaving an unhandled error', async () => {
        const fake = fakePager();
        const promise = runPager('a note', () => fake.child);
        fake.pager.emit('error', new Error('spawn less ENOENT'));
        await expect(promise).rejects.toThrow('spawn less ENOENT');
    });

    test('quitting before consuming stdin is not an error', async () => {
        const fake = fakePager();
        const promise = runPager('a note', () => fake.child);
        fake.stdin.emit(
            'error',
            Object.assign(new Error('broken pipe'), { code: 'EPIPE' })
        );
        fake.pager.emit('close', 0, null);
        await promise;
    });

    test('reports unsuccessful exit and unexpected stdin failures', async () => {
        const fake = fakePager();
        const promise = runPager('', () => fake.child);
        fake.pager.emit('close', 1, null);
        await expect(promise).rejects.toThrow('status 1');
        const second = fakePager();
        const secondPromise = runPager('', () => second.child);
        second.stdin.emit('error', new Error('write failed'));
        await expect(secondPromise).rejects.toThrow('write failed');
    });
});

test('errors from arbitrary thrown values are readable', () => {
    expect(errorMessage(new Error('offline'))).toBe('offline');
    expect(errorMessage('offline')).toBe('offline');
});
