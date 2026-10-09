import { join } from 'node:path';
import { homedir } from 'node:os';
import { parseEnv } from 'node:util';

/**
 * Load CLI defaults without overriding exported variables or Bun's startup env.
 * Bun native parseEnv supports quoted multiline values and double-quoted escapes.
 */
export async function loadEnvironment(
    options: {
        home?: string;
        cwd?: string;
        env?: Record<string, string | undefined>;
    } = {}
) {
    const env = options.env ?? Bun.env;
    const paths = [
        join(options.home ?? homedir(), '.config', 'tt-cli', '.env'),
        join(options.cwd ?? process.cwd(), '.env'),
    ];
    for (const path of paths) {
        let contents: string;
        try {
            contents = await Bun.file(path).text();
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
            throw new Error(`Cannot read environment file at ${path}`);
        }
        let defaults: ReturnType<typeof parseEnv>;
        try {
            defaults = parseEnv(contents);
        } catch {
            throw new Error(`Cannot parse environment file at ${path}`);
        }
        for (const [key, value] of Object.entries(defaults)) {
            if (env[key] === undefined && value !== undefined) env[key] = value;
        }
        return;
    }
}
