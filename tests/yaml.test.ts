import { expect, test } from 'bun:test';
import { dump, load } from 'js-yaml';

test('upgraded YAML parser preserves note metadata round trips', () => {
    const metadata = {
        id: 'note-id',
        title: 'A title: with punctuation',
        date: '2026-10-09',
        tags: ['research', 'daily-note'],
        published: false,
        createdAt: '2026-10-09T12:00:00.000Z',
    };
    expect(load(dump(metadata))).toEqual(metadata);
});

test('YAML merge keys cannot change the parsed object prototype', () => {
    const parsed = load(
        'base: &base\n  __proto__: {polluted: true}\nnote:\n  <<: *base\n'
    ) as { note: Record<string, unknown> };
    expect(Object.getPrototypeOf(parsed.note)).toBe(Object.prototype);
    expect(parsed.note.polluted).toBeUndefined();
});
