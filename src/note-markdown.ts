import type { NoteType } from '@tt-services';
import type { CreatableNote } from '@tt-services/src/services/notes';

export const getPrintableNoteContent = (note: NoteType | CreatableNote) => {
    return Object.fromEntries(
        Object.entries(note).filter(
            ([key]) =>
                key !== '_id' && key !== 'content' && key !== 'googleDocContent'
        )
    );
};

export function formatNoteAsMarkdown(note: NoteType): string {
    const metadata = getPrintableNoteContent(note);
    const frontmatter = Bun.YAML.stringify(metadata, null, 2);
    return ['---', frontmatter.trim(), '---', note.content].join('\n');
}

export type NoteFile = {
    content: string;
    path: string;
};

export async function extractFrontmatterFromMarkdownFile(
    file: NoteFile
): Promise<Record<string, any> | null> {
    const lines = file.content.split('\n');

    if (lines[0]?.trim() === '---') {
        let fmEndIndex = -1;
        for (let i = 1; i < lines.length; i++) {
            if (lines[i].trim() === '---') {
                fmEndIndex = i;
                break;
            }
        }

        if (fmEndIndex === -1) {
            return null;
        }

        const frontmatterRaw = lines.slice(1, fmEndIndex).join('\n');
        try {
            const parsedYaml = Bun.YAML.parse(frontmatterRaw);
            if (
                parsedYaml !== null &&
                typeof parsedYaml === 'object' &&
                !Array.isArray(parsedYaml)
            ) {
                return parsedYaml;
            } else {
                return null;
            }
        } catch (e) {
            return null;
        }
    }
    return null;
}

export function removeFrontmatterFromMarkdownFile(file: NoteFile): string {
    const lines = file.content.split('\n');

    if (lines[0]?.trim() === '---') {
        let fmEndIndex = -1;
        for (let i = 1; i < lines.length; i++) {
            if (lines[i].trim() === '---') {
                fmEndIndex = i;
                break;
            }
        }

        if (fmEndIndex !== -1) {
            return lines.slice(fmEndIndex + 1).join('\n');
        }
    }

    return file.content;
}
