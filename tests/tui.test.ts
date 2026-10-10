import { expect, test } from 'bun:test';
import { mkdtemp, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Exercise the actual pager entrypoint with an executable on an isolated PATH.
for (const scenario of ['read', 'early-exit', 'failure', 'missing']) {
    test(`pager subprocess: ${scenario}`, async () => {
        const dir = await mkdtemp(join(tmpdir(), 'tt-pager-'));
        try {
            const body =
                scenario === 'read'
                    ? 'process.stdout.write(await Bun.stdin.text());'
                    : `process.exit(${scenario === 'failure' ? 7 : 0});`;
            if (scenario !== 'missing') {
                await Bun.write(
                    join(dir, 'less'),
                    `#!${process.execPath}\n${body}`
                );
                await chmod(join(dir, 'less'), 0o755);
            }
            const modulePath = join(import.meta.dir, '../src/tui-helpers.ts');
            const input = 'A note 📝\n' + 'body\n'.repeat(20000);
            const runner = join(dir, 'runner.ts');
            await Bun.write(
                runner,
                `import {runPager} from ${JSON.stringify(modulePath)}; await runPager(${JSON.stringify(input)});`
            );
            const child = Bun.spawn([process.execPath, runner], {
                env: { HOME: dir, PATH: dir },
                stdout: 'pipe',
                stderr: 'pipe',
            });
            const [code, out, err] = await Promise.all([
                child.exited,
                new Response(child.stdout).text(),
                new Response(child.stderr).text(),
            ]);
            if (scenario === 'failure' || scenario === 'missing') {
                expect(code).not.toBe(0);
                expect(err).toContain(
                    scenario === 'failure' ? 'status 7' : 'less'
                );
            } else {
                expect(code).toBe(0);
                expect(err).toBe('');
                expect(out).toBe(scenario === 'read' ? input : '');
            }
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    });
}
