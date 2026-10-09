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

// Bun.YAML.parse has no strict/duplicate-key option. Validate the conventional
// unindented block mapping used by note frontmatter before parsing its values.
// Root flow maps, explicit/complex keys, root merges, and multiline keys are
// deliberately unsupported: guessing at their identity keys could attach a file
// to the wrong remote note. Indented nested values/anchors remain Bun's job.
function hasUniqueFrontmatterKeys(lines: string[]): boolean {
    const keys = new Set<string>();
    for (const rawLine of lines) {
        const line = rawLine.replace(/\r$/, '');
        if (line.includes('\r')) return false;
        if (/^\s*(?:#.*)?$/.test(line) || /^[ \t]/.test(line)) continue;
        const match = line.match(
            /^("(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|[^?:,\[\]{}#&*!|>'"%@` \t][^:#]*):(?:[ \t]|$)/
        );
        if (!match) return false;
        const keyMapping = Bun.YAML.parse(`${match[1]}: null`);
        if (
            !keyMapping ||
            typeof keyMapping !== 'object' ||
            Array.isArray(keyMapping)
        )
            return false;
        const names = Object.keys(keyMapping);
        if (names.length !== 1) return false;
        const key = names[0]!;
        if (key === '<<' || keys.has(key)) return false;
        keys.add(key);
    }
    return keys.size > 0;
}

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
            if (!hasUniqueFrontmatterKeys(lines.slice(1, fmEndIndex)))
                return null;
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
