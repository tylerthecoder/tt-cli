#!/usr/bin/env bun
import React, { useEffect, useMemo, useState } from 'react';
import { render, Box, Text, useApp, useInput } from 'ink';
import type { NoteMetadata as NoteType } from '@tt-services';
import { config } from 'dotenv';
import { join } from 'path';
import { homedir } from 'os';
import { exec, spawn } from 'child_process';
import { getNotes as getNotesCached, openNoteLink, tt } from './notes.ts';

const loadEnv = () => {
    const configPath = join(homedir(), '.config', 'tt-cli', '.env');
    const result = config({ path: configPath });
    if ((result as any).error) {
        config();
    }
};

const enterAltScreen = () => {
    try {
        process.stdout.write('\x1b[?1049h');
        process.stdout.write('\x1b[?25l');
        process.stdout.write('\x1b[2J\x1b[3J\x1b[H');
    } catch { }
};

const leaveAltScreen = () => {
    try {
        process.stdout.write('\x1b[?25h');
        process.stdout.write('\x1b[?1049l');
    } catch { }
};

const silenceConsole = () => {
    const original = {
        log: console.log,
        info: console.info,
        warn: console.warn,
        error: console.error,
    } as const;
    console.log = () => { };
    console.info = () => { };
    console.warn = () => { };
    console.error = (...args: any[]) => {
        try {
            const msg = args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
            process.stderr.write(`[log] ${msg}\n`);
        } catch { }
    };
    return () => {
        console.log = original.log;
        console.info = original.info;
        console.warn = original.warn;
        console.error = original.error;
    };
};

function truncate(str: string, maxLen: number) {
    if (str.length <= maxLen) return str;
    return str.slice(0, maxLen - 1) + '…';
}

function slugifyTitle(title: string) {
    return (title || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
}

function openInBrowser(url: string) {
    try { exec(`xdg-open "${url}" >/dev/null 2>&1 &`); } catch { }
}

async function viewWithLess(content: string) {
    try {
        if ((process.stdin as any).isTTY && typeof (process.stdin as any).setRawMode === 'function') {
            (process.stdin as any).setRawMode(false);
        }
        process.stdout.write('\x1b[?25h'); // show cursor for less
    } catch { }

    await new Promise<void>((resolve) => {
        const less = spawn('less', ['-R'], { stdio: ['pipe', 'inherit', 'inherit'] });
        less.stdin?.write(content);
        less.stdin?.end();
        less.on('exit', () => resolve());
        less.on('close', () => resolve());
    });

    try {
        if ((process.stdin as any).isTTY && typeof (process.stdin as any).setRawMode === 'function') {
            (process.stdin as any).setRawMode(true);
        }
        process.stdout.write('\x1b[?25l'); // hide cursor again
        process.stdout.write('\x1b[2J\x1b[3J\x1b[H'); // clear for redraw
    } catch { }
}

type Mode = 'list' | 'search' | 'tagSelect';

function useNotesData(reloadKey: number) {
    const [notes, setNotes] = useState<NoteType[] | null>(null);
    const [tags, setTags] = useState<string[] | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        setNotes(null);
        setTags(null);
        setError(null);
        (async () => {
            try {
                const allNotes = await getNotesCached();
                const tagSet = new Set<string>();
                for (const n of allNotes) (n.tags || []).forEach(t => tagSet.add(t));
                if (!cancelled) {
                    setNotes(allNotes);
                    setTags(Array.from(tagSet).sort());
                }
            } catch (e) {
                if (!cancelled) setError(e instanceof Error ? e.message : String(e));
            }
        })();
        return () => { cancelled = true; };
    }, [reloadKey]);

    return { notes, tags, error };
}

function NotesTui() {
    const { exit } = useApp();
    const [reloadKey, setReloadKey] = useState(0);
    const { notes, tags, error } = useNotesData(reloadKey);
    const [mode, setMode] = useState<Mode>('list');
    const [query, setQuery] = useState('');
    const [selectedTag, setSelectedTag] = useState<string | null>(null);
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [tagIndex, setTagIndex] = useState(0);

    const allTags = useMemo(() => ['(all)', ...(tags || [])], [tags]);

    const filtered = useMemo(() => {
        if (!notes) return [] as NoteType[];
        const lcq = query.toLowerCase();
        return notes
            .filter(n => !selectedTag || n.tags?.includes(selectedTag))
            .filter(n => !lcq || n.title.toLowerCase().includes(lcq))
            .slice(0, 1000);
    }, [notes, query, selectedTag]);

    useEffect(() => {
        if (selectedIndex >= filtered.length) setSelectedIndex(Math.max(0, filtered.length - 1));
    }, [filtered.length]);

    useEffect(() => {
        const total = allTags.length;
        if (tagIndex >= total) setTagIndex(Math.max(0, total - 1));
    }, [allTags.length]);

    useInput(async (input, key) => {
        // Global refresh shortcut: r or Ctrl+L (disabled while typing in search mode)
        if (mode !== 'search' && (input === 'r' || (key.ctrl && input === 'l'))) {
            try { process.stdout.write('\x1b[2J\x1b[3J\x1b[H'); } catch { }
            setReloadKey(k => k + 1);
            return;
        }

        if (mode === 'search') {
            if (key.return) { setMode('list'); return; }
            if (key.escape) { setMode('list'); return; }
            if (key.backspace || key.delete) { setQuery(q => q.slice(0, -1)); return; }
            if (key.ctrl && input === 'u') { setQuery(''); return; }
            if (input) { setQuery(q => q + input); }
            return;
        }

        if (mode === 'tagSelect') {
            if (key.upArrow || input === 'k') setTagIndex(i => Math.max(0, i - 1));
            else if (key.downArrow || input === 'j') setTagIndex(i => Math.min(allTags.length - 1, i + 1));
            else if (input === 'b') setTagIndex(i => Math.max(0, i - 10));
            else if (input === 'f') setTagIndex(i => Math.min(allTags.length - 1, i + 10));
            else if (input === 'g') setTagIndex(0);
            else if (input === 'G') setTagIndex(Math.max(0, allTags.length - 1));
            else if (key.escape) setMode('list');
            else if (key.return) { const t = allTags[tagIndex]; setSelectedTag(t === '(all)' ? null : t); setMode('list'); }
            return;
        }

        // list mode
        if (key.upArrow || input === 'k') setSelectedIndex(i => Math.max(0, i - 1));
        else if (key.downArrow || input === 'j') setSelectedIndex(i => Math.min(filtered.length - 1, i + 1));
        else if (input === 'b') setSelectedIndex(i => Math.max(0, i - 10));
        else if (input === 'f') setSelectedIndex(i => Math.min(filtered.length - 1, i + 10));
        else if (input === 'g') setSelectedIndex(0);
        else if (input === 'G') setSelectedIndex(Math.max(0, filtered.length - 1));
        else if (input === '/') setMode('search');
        else if (input === 't') { setMode('tagSelect'); setTagIndex(0); }
        else if (input === 'o') {
            const target = filtered[selectedIndex];
            if (!target) return;
            openNoteLink(target.id);
            return;
        }
        else if (input === 'v') {
            const target = filtered[selectedIndex];
            if (!target) return;
            (async () => {
                try {
                    const full = await tt.notes.getNoteById(target.id);
                    if (!full) return;
                    const body = `# ${full.title}\n\n${full.content || ''}\n`;
                    await viewWithLess(body);
                    // After less, redraw prompt area by bumping a render
                    // No state change needed; screen clear will cause Ink to re-render
                } catch (e) {
                    // ignore errors; stay in TUI
                }
            })();
            return;
        }
        else if (input === 'c' && key.ctrl) exit();
        else if (input === 'q') exit();
        // Enter no longer prints & exits
    });

    if (error) return (
        <Box flexDirection="column">
            <Text color="red">Error: {error}</Text>
        </Box>
    );

    if (!notes) return (
        <Box flexDirection="column">
            <Text>Loading notes…</Text>
        </Box>
    );

    const legend = '[j/k] up/down  [f/b] jump 10  [g/G] start/end  [/] search  [t] tags  [o] open in browser  [v] view (less)  [r] refresh  [q] quit  [Ctrl+C] quit';

    const termRows = Math.max(10, (process.stdout.rows || 24));
    const tagWindowSize = Math.max(5, Math.min(20, termRows - 10));
    const tagStart = Math.max(0, Math.min(tagIndex - Math.floor(tagWindowSize / 2), Math.max(0, allTags.length - tagWindowSize)));
    const tagEnd = Math.min(allTags.length, tagStart + tagWindowSize);

    return (
        <Box flexDirection="column">
            <Box>
                <Text color="cyan">Notes</Text>
                <Text>  •  </Text>
                <Text>Query: </Text>
                <Text color={mode === 'search' ? 'yellow' : undefined}>{query || '(blank)'}</Text>
                <Text>  •  Tag: </Text>
                <Text color={mode === 'tagSelect' ? 'yellow' : undefined}>{selectedTag || '(all)'}</Text>
                <Text>  •  Showing {filtered.length} / {notes.length}</Text>
            </Box>

            {mode === 'tagSelect' ? (
                <Box flexDirection="column" marginTop={1} borderStyle="round" paddingX={1}>
                    <Text>
                        Select Tag (Enter to choose, Esc to cancel)  •  {tagStart + 1}-{tagEnd} of {allTags.length}  •  Keys: j/k, f/b, g/G
                    </Text>
                    <Box flexDirection="column" marginTop={1}>
                        {tagStart > 0 && (
                            <Text color="gray">… {tagStart} more above …</Text>
                        )}
                        {allTags.slice(tagStart, tagEnd).map((t, i) => {
                            const realIndex = tagStart + i;
                            const isSel = realIndex === tagIndex;
                            return (
                                <Text key={`${t}-${realIndex}`} color={isSel ? 'green' : undefined}>
                                    {isSel ? '➤ ' : '  '} {t}
                                </Text>
                            );
                        })}
                        {tagEnd < allTags.length && (
                            <Text color="gray">… {allTags.length - tagEnd} more below …</Text>
                        )}
                    </Box>
                </Box>
            ) : (
                <Box flexDirection="column" marginTop={1}>
                    {filtered.length === 0 ? (
                        <Text color="gray">No notes match your filters.</Text>
                    ) : (
                        filtered.slice(Math.max(0, selectedIndex - 10), Math.max(0, selectedIndex - 10) + 25).map((n, i) => {
                            const start = Math.max(0, selectedIndex - 10);
                            const realIndex = start + i;
                            const isSel = realIndex === selectedIndex;
                            return (
                                <Text key={n.id} color={isSel ? 'green' : undefined}>
                                    {isSel ? '➤ ' : '  '}
                                    {truncate(n.title || '(untitled)', 72)}
                                    {n.tags && n.tags.length ? `  ·  [${n.tags.join(', ')}]` : ''}
                                </Text>
                            );
                        })
                    )}
                </Box>
            )}

            <Box marginTop={1}>
                <Text color="gray">{legend}</Text>
            </Box>

            {mode === 'search' && (
                <Box>
                    <Text color="yellow">Type to search. Enter to apply, Esc to cancel. Backspace/Delete to edit. Ctrl+U to clear.</Text>
                </Box>
            )}
        </Box>
    );
}

export async function runNotesTui() {
    loadEnv();
    if (process.stdin && typeof process.stdin.resume === 'function') {
        process.stdin.resume();
    }

    enterAltScreen();
    const restoreConsole = silenceConsole();

    const instance = render(<NotesTui />, {
        stdin: process.stdin as any,
        stdout: process.stdout as any,
        stderr: process.stderr as any,
        exitOnCtrlC: true,
        patchConsole: true,
    });

    const restoreInput = () => {
        try {
            if (process.stdin && (process.stdin as any).isTTY && typeof (process.stdin as any).setRawMode === 'function') {
                (process.stdin as any).setRawMode(false);
            }
        } catch { }
    };

    const cleanupAndExit = (code: number = 0) => {
        try { restoreInput(); } catch { }
        try { instance.unmount(); } catch { }
        try { restoreConsole(); } catch { }
        try { leaveAltScreen(); } catch { }
        process.exit(code);
    };

    const onSigint = () => cleanupAndExit(130);
    process.on('SIGINT', onSigint);
    process.on('SIGTERM', () => cleanupAndExit(143));
    process.on('exit', () => { try { restoreInput(); } catch { }; try { restoreConsole(); } catch { }; try { leaveAltScreen(); } catch { } });

    try {
        await instance.waitUntilExit();
    } finally {
        process.off('SIGINT', onSigint);
        try { restoreConsole(); } catch { }
        try { leaveAltScreen(); } catch { }
    }
}

if (import.meta.main) {
    runNotesTui();
}