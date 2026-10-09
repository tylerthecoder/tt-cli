import { expect, test } from 'bun:test';
import type { NoteType } from '@tt-services';
import {
    extractFrontmatterFromMarkdownFile,
    formatNoteAsMarkdown,
    removeFrontmatterFromMarkdownFile,
} from '../src/note-markdown.ts';

const metadata = {
    id: 'note-id',
    title: 'A title: with punctuation',
    date: '2026-10-09',
    tags: ['research', 'daily-note'],
    published: false,
    createdAt: '2026-10-09T12:00:00.000Z',
    updatedAt: '2026-10-09T12:00:00.000Z',
};

async function roundTrip(extra: Record<string, unknown> = {}) {
    const note = { ...metadata, content: '# Body\n\nA paragraph.\n', ...extra };
    const file = {
        path: 'fixture.md',
        content: formatNoteAsMarkdown(note as NoteType),
    };
    return {
        note,
        file,
        parsed: await extractFrontmatterFromMarkdownFile(file),
    };
}

test('Bun YAML preserves note metadata and exact Markdown body', async () => {
    const { note, file, parsed } = await roundTrip();
    expect(parsed).toEqual(metadata);
    expect(removeFrontmatterFromMarkdownFile(file)).toBe(note.content);
});

test('Bun YAML preserves scalar-looking strings, nulls, arrays, and nested metadata', async () => {
    const extra = {
        aliases: ['true', 'false', 'null', '001', '2026-10-09', 'yes', 'on'],
        nil: null,
        nested: { count: 4, ratio: 0.25, enabled: true, tags: ['a', 'b'] },
        description: 'First line\nSecond line\n',
    };
    expect((await roundTrip(extra)).parsed).toEqual({ ...metadata, ...extra });
});

test('Date values become ISO timestamps, undefined fields are omitted, and array positions survive', async () => {
    const timestamp = new Date('2026-10-09T12:00:00.000Z');
    const extra = {
        createdAt: timestamp,
        unused: undefined,
        nested: { date: timestamp, unused: undefined },
        values: [1, undefined, null, timestamp],
    };
    const { parsed } = await roundTrip(extra);
    expect(parsed).toEqual({
        ...metadata,
        nested: { date: timestamp.toISOString() },
        values: [1, null, null, timestamp.toISOString()],
    });
    expect(extra.createdAt).toBe(timestamp);
    expect(extra.values[1]).toBeUndefined();
    expect(Object.hasOwn(extra, 'unused')).toBe(true);
});

test('formatting does not delete database IDs or alter the input note', async () => {
    const note = Object.freeze({
        ...metadata,
        content: 'Body',
        _id: 'database-only-id',
        googleDocContent: 'database-only-content',
    });
    const content = formatNoteAsMarkdown(note as NoteType);
    const parsed = await extractFrontmatterFromMarkdownFile({
        path: 'fixture.md',
        content,
    });
    expect(parsed).toEqual(metadata);
    expect(note._id).toBe('database-only-id');
    expect(note.googleDocContent).toBe('database-only-content');
});

test('legacy YAML timestamps, quoted strings, anchors, and merge keys remain usable', async () => {
    const parsed = await extractFrontmatterFromMarkdownFile({
        path: 'legacy.md',
        content: `---
id: note-id
title: 'true'
date: 2026-10-09
createdAt: 2026-10-09T12:00:00.000Z
defaults: &defaults
  published: false
  tags: [daily, research]
settings:
  <<: *defaults
  title: Override
aliases: *defaults
---
Body`,
    });
    expect(parsed).toEqual({
        id: 'note-id',
        title: 'true',
        date: '2026-10-09',
        createdAt: '2026-10-09T12:00:00.000Z',
        defaults: { published: false, tags: ['daily', 'research'] },
        settings: {
            published: false,
            tags: ['daily', 'research'],
            title: 'Override',
        },
        aliases: { published: false, tags: ['daily', 'research'] },
    });
});

test('YAML merge keys cannot change the parsed object prototype', async () => {
    const parsed = await extractFrontmatterFromMarkdownFile({
        path: 'fixture.md',
        content:
            '---\nbase: &base\n  __proto__: {polluted: true}\nnote:\n  <<: *base\n---\n',
    });
    expect(Object.getPrototypeOf(parsed!.note)).toBe(Object.prototype);
    expect(parsed!.note.polluted).toBeUndefined();
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
});

for (const frontmatter of [
    '',
    'null',
    '[a, b]',
    'just a string',
    'broken: [',
]) {
    test(`non-mapping or invalid frontmatter is rejected: ${JSON.stringify(frontmatter)}`, async () => {
        expect(
            await extractFrontmatterFromMarkdownFile({
                path: 'fixture.md',
                content: `---\n${frontmatter}\n---\nBody`,
            })
        ).toBeNull();
    });
}

for (const frontmatter of [
    'id: first\nid: second',
    'id: first\n"id": second',
    "id: first\n'id': second",
    'id: first\n"i\\u0064": second',
    'id: first\nid : second',
    'title: first\ntitle: second',
    '{id: first, id: second}',
    '? id\n: first\nid: second',
    'base: &base {id: first}\n<<: *base',
    '  id: first\n  id: second',
]) {
    test(`ambiguous or duplicate identity mapping fails closed: ${JSON.stringify(frontmatter)}`, async () => {
        expect(
            await extractFrontmatterFromMarkdownFile({
                path: 'fixture.md',
                content: `---\n${frontmatter}\n---\nBody`,
            })
        ).toBeNull();
    });
}

test('quoted unique keys and nested anchors are accepted', async () => {
    expect(
        await extractFrontmatterFromMarkdownFile({
            path: 'fixture.md',
            content:
                '---\n"id": example\n\'title\': Title\nextra data: &extra\n  description: Nested\n  id: nested-id\ncopy: *extra\n---\nBody',
        })
    ).toEqual({
        id: 'example',
        title: 'Title',
        'extra data': { description: 'Nested', id: 'nested-id' },
        copy: { description: 'Nested', id: 'nested-id' },
    });
});

test('CRLF block frontmatter keeps nested values and the original body', async () => {
    const file = {
        path: 'windows.md',
        content:
            '---\r\nid: windows-note\r\ntags:\r\n  - research\r\n---\r\nBody\r\n',
    };
    expect(await extractFrontmatterFromMarkdownFile(file)).toEqual({
        id: 'windows-note',
        tags: ['research'],
    });
    expect(removeFrontmatterFromMarkdownFile(file)).toBe('Body\r\n');
});

test('bare carriage returns cannot hide duplicate identity keys', async () => {
    expect(
        await extractFrontmatterFromMarkdownFile({
            path: 'ambiguous.md',
            content: '---\nid: first\rid: second\n---\nBody',
        })
    ).toBeNull();
});
