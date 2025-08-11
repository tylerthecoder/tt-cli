import { TylersThings } from '@tt-services/src';
import { createInterface } from 'readline/promises';
import pino, { type Logger } from 'pino';

export const colors = {
    reset: "\x1b[0m",
    green: "\x1b[32m",
    red: "\x1b[31m",
    yellow: "\x1b[33m",
    cyan: "\x1b[36m",
    magenta: "\x1b[35m",
    blue: "\x1b[34m",
    dim: "\x1b[2m",
};

export async function confirm(logger: Logger, prompt: string) {
    await new Promise(resolve => logger.flush(resolve));

    const rl = createInterface({
        input: process.stdin,
        output: process.stdout
    });
    const answer = await rl.question(prompt);
    rl.close();
    return answer.toLowerCase() === 'y';
}

export const logger = pino({
    name: "tt-cli",
    transport: {
        target: 'pino-pretty',
        options: {
            ignore: 'module,filename',
        }
    },
});

export const getTT = async () => {
    const tt = await TylersThings.make({ logger });
    return tt;
}