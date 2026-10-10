import { expect, test } from 'bun:test';
import {
    formatNoteAsMarkdown,
    readNoteMarkdown,
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

for (const content of [
    '',
    'Body without trailing newline',
    '# Body\n\nParagraph.\n',
    'Body\r\n',
    '---\nBody starts with a rule\n',
]) {
    test(`note formatting preserves metadata and exact body: ${JSON.stringify(content)}`, () => {
        const note = Object.freeze({
            ...metadata,
            content,
            _id: 'database-id',
            googleDocContent: 'remote content',
        });
        const parsed = readNoteMarkdown({
            path: 'fixture.md',
            content: formatNoteAsMarkdown(note),
        });
        expect(parsed).toEqual({ data: metadata, content });
        expect(note._id).toBe('database-id');
        expect(note.googleDocContent).toBe('remote content');
    });
}

test('plain Markdown remains available for creating a note', () => {
    expect(
        readNoteMarkdown({ path: 'draft.md', content: '# Draft\n' })
    ).toEqual({ data: {}, content: '# Draft\n' });
});

test('malformed frontmatter is rejected', () => {
    for (const content of [
        '---',
        '---\ntitle: Missing end',
        '---\nbroken: [\n---\nBody',
        '---\n[id]\n---\nBody',
    ]) {
        expect(readNoteMarkdown({ path: 'invalid.md', content })).toBeNull();
    }
});

test('language-tagged JavaScript never executes', () => {
    for (const language of ['javascript', 'js', 'JavaScript']) {
        const original = process.env.TT_FRONTMATTER_EXECUTED;
        try {
            delete process.env.TT_FRONTMATTER_EXECUTED;
            const content = `---${language}\n(process.env.TT_FRONTMATTER_EXECUTED = 'yes', {title: 'Executed'})\n---\nBody`;
            expect(
                readNoteMarkdown({ path: 'untrusted.md', content })
            ).toBeNull();
            expect(process.env.TT_FRONTMATTER_EXECUTED).toBeUndefined();
        } finally {
            if (original === undefined)
                delete process.env.TT_FRONTMATTER_EXECUTED;
            else process.env.TT_FRONTMATTER_EXECUTED = original;
        }
    }
});
