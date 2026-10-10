import matter from 'gray-matter';
import type { NoteType } from '@tt-services';

const yamlOnly = {
    engines: {
        javascript: () => {
            throw new Error('Only YAML frontmatter is supported');
        },
        json: () => {
            throw new Error('Only YAML frontmatter is supported');
        },
    },
};

export type NoteFile = { content: string; path: string };

export function readNoteMarkdown(file: NoteFile) {
    try {
        const parsed = matter(file.content, yamlOnly);
        // gray-matter accepts an unterminated header; do not import it as a note.
        if (
            (parsed.matter ||
                /^(?:\uFEFF)?---(?:\r?\n|$)/.test(file.content)) &&
            !/\n---(?:\r?\n|$)/.test(file.content)
        )
            return null;
        if (
            !parsed.data ||
            typeof parsed.data !== 'object' ||
            Array.isArray(parsed.data)
        )
            return null;
        return { data: parsed.data, content: parsed.content };
    } catch {
        return null;
    }
}

export function formatNoteAsMarkdown(note: NoteType): string {
    const metadata = Object.fromEntries(
        Object.entries(note).filter(
            ([key]) =>
                key !== '_id' && key !== 'content' && key !== 'googleDocContent'
        )
    );
    // Serialize the header separately: gray-matter adds a newline to the body.
    return (
        matter.stringify({ content: '' }, metadata).trimEnd() +
        '\n' +
        note.content
    );
}
