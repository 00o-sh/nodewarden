import { describe, expect, it } from 'vitest';
import { readNullableFullUpdateField } from '../src/handlers/cipher-full-update';

describe('readNullableFullUpdateField', () => {
  it('returns the first present alias, including explicit null', () => {
    expect(readNullableFullUpdateField<string>({ notes: 'a', Notes: 'b' }, ['notes', 'Notes'])).toBe('a');
    expect(readNullableFullUpdateField<string>({ Notes: 'b' }, ['notes', 'Notes'])).toBe('b');
    expect(readNullableFullUpdateField<string>({ notes: null, Notes: 'b' }, ['notes', 'Notes'])).toBeNull();
  });

  it('treats an absent or undefined property as cleared', () => {
    expect(readNullableFullUpdateField<string>({}, ['notes', 'Notes'])).toBeNull();
    expect(readNullableFullUpdateField<string>({ notes: undefined }, ['notes', 'Notes'])).toBeNull();
  });

  it('ignores inherited properties and non-object sources', () => {
    const inherited = Object.create({ notes: 'proto' }) as Record<string, unknown>;
    expect(readNullableFullUpdateField<string>(inherited, ['notes'])).toBeNull();
    expect(readNullableFullUpdateField<string>(null, ['notes'])).toBeNull();
    expect(readNullableFullUpdateField<string>('notes', ['notes'])).toBeNull();
  });
});
