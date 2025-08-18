import { TylersThings } from '@tt-services/src';
import pino, { type Logger } from 'pino';
import inquirer from 'inquirer';

export const colors = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    cyan: '\x1b[36m',
    magenta: '\x1b[35m',
    blue: '\x1b[34m',
    dim: '\x1b[2m',
};

export async function confirm(logger2: Logger, prompt: string) {
    await new Promise(resolve => logger.flush(resolve));

    const confirm = await inquirer.prompt([
        {
            type: 'confirm',
            name: 'confirm',
            message: prompt,
        },
    ]);
    return confirm.confirm;
}

export const pickOptionCli = async <T extends string>(
    logger: Logger,
    prompt: string,
    options: T[]
): Promise<T> => {
    await new Promise(resolve => logger.flush(resolve));
    const answer = await inquirer.prompt([
        {
            type: 'list',
            name: 'option',
            message: prompt,
            choices: options,
        },
    ]);
    return answer.option;
};

const transport = pino.transport({
    target: 'pino-pretty',
    options: {
        ignore: 'module,filename',
    },
    // @ts-ignore
    sync: true,
});

export const logger = pino(transport);

export const getTT = async () => {
    const tt = await TylersThings.make({ logger });
    return tt;
};
