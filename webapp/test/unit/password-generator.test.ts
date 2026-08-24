import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clampInteger,
  defaultGeneratorSettings,
  estimateStrength,
  generateEmail,
  generatePassphrase,
  generatePassword,
  generatePin,
  generateUsername,
  generateValue,
  normalizeGeneratorSettings,
} from '@/lib/password-generator';
import { EFFLongWordList } from '@/lib/eff-word-list';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('clampInteger', () => {
  it('rounds, clamps to range, and falls back on non-finite input', () => {
    expect(clampInteger(4.6, 0, 9, 3)).toBe(5);
    expect(clampInteger(100, 0, 9, 3)).toBe(9);
    expect(clampInteger(-100, 0, 9, 3)).toBe(0);
    expect(clampInteger('abc', 0, 9, 3)).toBe(3);
    expect(clampInteger(NaN, 0, 9, 3)).toBe(3);
    expect(clampInteger(7, 0, 9, 3)).toBe(7);
  });
});

describe('normalizeGeneratorSettings', () => {
  it('fills defaults for empty/invalid input', () => {
    const s = normalizeGeneratorSettings(undefined);
    expect(s.mode).toBe(defaultGeneratorSettings.mode);
    expect(s.password.length).toBe(16);
  });

  it('clamps out-of-range password numeric fields', () => {
    const s = normalizeGeneratorSettings({ password: { length: 9999, minUppercase: 99 } });
    expect(s.password.length).toBe(128); // max 128
    expect(s.password.minUppercase).toBe(9); // max 9
    const low = normalizeGeneratorSettings({ password: { length: 1 } });
    expect(low.password.length).toBe(5); // min 5
  });

  it('clamps passphrase words and truncates the separator to one char', () => {
    const s = normalizeGeneratorSettings({ passphrase: { words: 99, separator: 'abc' } });
    expect(s.passphrase.words).toBe(20); // max 20
    expect(s.passphrase.separator).toHaveLength(1);
    expect(s.passphrase.wordList).toBe('eff'); // coerced unless exactly 'custom'
  });

  it('migrates a legacy username/email-type setting to email mode', () => {
    const s = normalizeGeneratorSettings({ mode: 'username', username: { type: 'plusAddressed' } });
    expect(s.mode).toBe('email');
  });

  it('coerces an unknown sshKey type to ed25519 and validates rsaLength', () => {
    const s = normalizeGeneratorSettings({ sshKey: { type: 'nope', rsaLength: 5000 } });
    expect(s.sshKey.type).toBe('ed25519');
    expect([2048, 3072, 4096]).toContain(s.sshKey.rsaLength);
  });
});

describe('generatePassword', () => {
  const base = { length: 20, uppercase: true, lowercase: true, numbers: true, special: true, minUppercase: 1, minLowercase: 1, minNumbers: 1, minSpecial: 1, avoidAmbiguous: false };

  it('produces a password of the requested length using only enabled sets', () => {
    const pw = generatePassword(base);
    expect(pw).toHaveLength(20);
    expect(pw).toMatch(/^[A-Za-z0-9!@#$%^&*_\-+=:;,.?~]+$/);
    // Minima honoured: at least one of each enabled class.
    expect(pw).toMatch(/[A-Z]/);
    expect(pw).toMatch(/[a-z]/);
    expect(pw).toMatch(/[0-9]/);
    expect(pw).toMatch(/[!@#$%^&*_\-+=:;,.?~]/);
  });

  it('excludes ambiguous characters when avoidAmbiguous is set', () => {
    const pw = generatePassword({ ...base, special: false, minSpecial: 0, length: 80, avoidAmbiguous: true });
    // Ambiguous set: I L O l o 0 1 | — none may appear (special is off here).
    expect(pw).not.toMatch(/[ILOlo01|]/);
  });

  it('falls back to lowercase-only when every character class is disabled', () => {
    const pw = generatePassword({ ...base, uppercase: false, lowercase: false, numbers: false, special: false, minUppercase: 0, minLowercase: 0, minNumbers: 0, minSpecial: 0 });
    expect(pw).toMatch(/^[a-z]+$/);
  });

  it('grows the length to fit the sum of minima', () => {
    const pw = generatePassword({ ...base, length: 4, minUppercase: 3, minLowercase: 3, minNumbers: 3, minSpecial: 3 });
    expect(pw.length).toBe(12); // max(4, 3+3+3+3)
  });
});

describe('generatePin', () => {
  it('produces digits of the requested length', () => {
    const pin = generatePin({ length: 8 });
    expect(pin).toHaveLength(8);
    expect(pin).toMatch(/^[0-9]+$/);
  });
});

describe('generatePassphrase', () => {
  // The EFF long wordlist holds four hyphenated entries ("drop-down", "felt-tip", "t-shirt",
  // "yo-yo"), so splitting a phrase on a '-' separator over-counts whenever one is drawn. Drive
  // the generator from a stubbed random source instead of asserting on a split.
  const stubWordIndices = (indices: number[]) => {
    const queue = [...indices];
    const real = globalThis.crypto;
    vi.stubGlobal('crypto', {
      subtle: real.subtle,
      randomUUID: () => real.randomUUID(),
      getRandomValues: (buffer: Uint32Array) => {
        buffer[0] = queue.length ? (queue.shift() as number) : 0;
        return buffer;
      },
    });
  };

  it('produces the requested number of words joined by the separator', () => {
    const indices = [10, 20, 30, 40];
    stubWordIndices(indices);
    const phrase = generatePassphrase({ words: 4, separator: '-', capitalize: false, includeNumber: false, wordList: 'eff', customWords: '' });
    expect(phrase).toBe(indices.map((index) => EFFLongWordList[index]).join('-'));
  });

  it('joins exactly the requested number of words when one of them contains the separator', () => {
    const indices = [EFFLongWordList.indexOf('yo-yo'), 20, 30];
    stubWordIndices(indices);
    const phrase = generatePassphrase({ words: 3, separator: '-', capitalize: false, includeNumber: false, wordList: 'eff', customWords: '' });
    expect(phrase).toBe(['yo-yo', EFFLongWordList[20], EFFLongWordList[30]].join('-'));
    expect(phrase.split('-')).toHaveLength(4); // the hyphen inside "yo-yo" is not a word boundary
  });

  it('draws every word from the wordlist using the real random source', () => {
    const words = generatePassphrase({ words: 4, separator: ' ', capitalize: false, includeNumber: false, wordList: 'eff', customWords: '' }).split(' ');
    expect(words).toHaveLength(4);
    for (const word of words) expect(EFFLongWordList).toContain(word);
  });

  it('capitalizes each word when requested', () => {
    stubWordIndices([EFFLongWordList.indexOf('yo-yo'), 20, 30]);
    const phrase = generatePassphrase({ words: 3, separator: '-', capitalize: true, includeNumber: false, wordList: 'eff', customWords: '' });
    const capitalized = (word: string) => word[0].toUpperCase() + word.slice(1);
    expect(phrase).toBe(['Yo-yo', capitalized(EFFLongWordList[20]), capitalized(EFFLongWordList[30])].join('-'));
  });

  it('appends a digit somewhere when includeNumber is set', () => {
    const phrase = generatePassphrase({ words: 3, separator: '-', capitalize: false, includeNumber: true, wordList: 'eff', customWords: '' });
    expect(phrase).toMatch(/[0-9]/);
  });
});

describe('generateUsername', () => {
  it('replaces a word with a non-empty customWord', () => {
    const name = generateUsername({ words: 2, delimiter: '', capitalize: false, includeNumber: false, customWord: 'zzcustomzz', wordList: 'eff', customWords: '' });
    expect(name.toLowerCase()).toContain('zzcustomzz');
  });
});

describe('generateEmail', () => {
  it('builds a catch-all address on a valid domain', () => {
    const email = generateEmail({ type: 'catchAll', email: '', domain: 'example.com' });
    expect(email).toMatch(/^[^@]+@example\.com$/);
  });

  it('builds a subdomain address from a valid base email', () => {
    const email = generateEmail({ type: 'subdomain', email: 'alice@example.com', domain: '' });
    expect(email).toMatch(/^alice@[^.]+\.example\.com$/);
  });

  it('builds a plus-addressed alias from a valid base email', () => {
    const email = generateEmail({ type: 'plusAddressed', email: 'alice@example.com', domain: '' });
    expect(email).toMatch(/^alice\+[^@]+@example\.com$/);
  });

  it('returns empty for an invalid configuration', () => {
    expect(generateEmail({ type: 'catchAll', email: '', domain: 'not a domain' })).toBe('');
    expect(generateEmail({ type: 'plusAddressed', email: 'not-an-email', domain: '' })).toBe('');
  });
});

describe('generateValue', () => {
  it('returns empty string for sshKey mode (handled elsewhere)', () => {
    expect(generateValue({ ...defaultGeneratorSettings, mode: 'sshKey' })).toBe('');
  });

  it('dispatches to the pin generator for pin mode', () => {
    const value = generateValue({ ...defaultGeneratorSettings, mode: 'pin', pin: { length: 5 } });
    expect(value).toMatch(/^[0-9]{5}$/);
  });
});

describe('estimateStrength', () => {
  it('scores by mode/length deterministically', () => {
    expect(estimateStrength('username', 'anything')).toBe(0);
    expect(estimateStrength('email', 'a@b.com')).toBe(0);
    expect(estimateStrength('sshKey', 'x')).toBe(0);
    expect(estimateStrength('pin', '12345')).toBe(1); // <6
    expect(estimateStrength('pin', '123456')).toBe(2); // >=6
    expect(estimateStrength('pin', '12345678')).toBe(3); // >=8
    expect(estimateStrength('pin', '1234567890')).toBe(4); // >=10
    expect(estimateStrength('passphrase', 'a-b-c-d-e-f')).toBe(3); // 6 words -> floor(6/2)=3
    expect(estimateStrength('password', 'x'.repeat(20))).toBe(4); // floor(20/5)=4, capped 4
    expect(estimateStrength('password', 'xxxxx')).toBe(1); // floor(5/5)=1
  });
});
