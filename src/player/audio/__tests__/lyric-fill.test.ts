import { fillDirection, fillWords, lineFillEnd, MIN_LINE_FILL, SECONDS_PER_LETTER, wordProgress } from '../lyric-fill';
import { fromLyricDto, type LyricLine } from '../lyrics';

const T = 10_000_000;

describe('lyric fill', () => {
  it('fills a line from its start to the next line, word by word by letters', () => {
    const lines: LyricLine[] = [
      { text: 'Hello there my friend', start: 10 },
      { text: 'Next', start: 12 },
    ];
    expect(lineFillEnd(lines, 0)).toBe(12);
    const words = fillWords(lines, 0);
    expect(words.map((w) => w.text)).toEqual(['Hello', 'there', 'my', 'friend']);
    // 18 letters over 2 s: "Hello" takes 5/18 of it.
    expect(words[0]!.start).toBe(10);
    expect(words[0]!.end).toBeCloseTo(10 + (5 / 18) * 2);
    expect(words[3]!.end).toBeCloseTo(12);
    for (let i = 1; i < words.length; i++) expect(words[i]!.start).toBeCloseTo(words[i - 1]!.end);
  });

  it('caps the fill at the sung length over a long instrumental gap', () => {
    const lines: LyricLine[] = [
      { text: 'Short line', start: 0 },
      { text: 'After the solo', start: 40 },
    ];
    const end = lineFillEnd(lines, 0);
    expect(end).toBeCloseTo(9 * SECONDS_PER_LETTER);
    expect(end).toBeLessThan(40);
    expect(fillWords(lines, 0).at(-1)!.end).toBeCloseTo(end);
  });

  it('gives the last line and a tiny line a sensible length', () => {
    const lines: LyricLine[] = [{ text: 'Oh', start: 5 }];
    expect(lineFillEnd(lines, 0)).toBe(5 + MIN_LINE_FILL);
    expect(fillWords([{ text: '', start: 3 }, { text: 'x', start: 4 }], 0)).toEqual([{ text: '♪', start: 3, end: 4 }]);
  });

  it('skips lines with the same start when it looks for the next line', () => {
    const lines: LyricLine[] = [
      { text: 'One two', start: 10 },
      { text: 'Echo', start: 10 },
      { text: 'Three', start: 11 },
    ];
    expect(lineFillEnd(lines, 0)).toBe(11);
  });

  it('uses word cues when the server has them', () => {
    const lyrics = fromLyricDto({
      Lyrics: [
        {
          Text: 'Hello world again',
          Start: 10 * T,
          Cues: [
            { Position: 0, EndPosition: 5, Start: 10 * T, End: 10.4 * T },
            { Position: 6, EndPosition: 11, Start: 11 * T, End: 12 * T },
            { Position: 12, EndPosition: 17, Start: 12.5 * T, End: null },
          ],
        },
        { Text: 'Next', Start: 20 * T },
      ],
    });
    const words = fillWords(lyrics!.lines, 0);
    expect(words).toEqual([
      { text: 'Hello', start: 10, end: 10.4 },
      { text: 'world', start: 11, end: 12 },
      // No end and no later cue: its sung length (5 letters).
      { text: 'again', start: 12.5, end: 12.5 + 5 * SECONDS_PER_LETTER },
    ]);
    expect(wordProgress(words[1]!.start, words[1]!.end, 11.5)).toBeCloseTo(0.5);
  });

  it('keeps cue positions right when the line text is trimmed', () => {
    const lyrics = fromLyricDto({
      Lyrics: [{ Text: '  Hi you', Start: 0, Cues: [{ Position: 2, EndPosition: 4, Start: 0, End: T }, { Position: 5, EndPosition: 8, Start: T, End: 2 * T }] }],
    });
    expect(lyrics!.lines[0]!.cues).toEqual([
      { from: 0, to: 2, start: 0, end: 1 },
      { from: 3, to: 6, start: 1, end: 2 },
    ]);
    expect(fillWords(lyrics!.lines, 0).map((w) => [w.text, w.start, w.end])).toEqual([
      ['Hi', 0, 1],
      ['you', 1, 2],
    ]);
  });

  it('fills an Arabic line in reading order, from the right', () => {
    const lines: LyricLine[] = [
      { text: 'قلبي يحبك كثيرا', start: 30 },
      { text: 'Next', start: 33 },
    ];
    expect(fillDirection(lines[0]!.text)).toBe('rtl');
    expect(fillDirection('Hello')).toBe('ltr');
    const words = fillWords(lines, 0);
    // The first word in the string is the first sung: the rightmost one on screen.
    expect(words.map((w) => w.text)).toEqual(['قلبي', 'يحبك', 'كثيرا']);
    expect(words[0]!.start).toBe(30);
    // 13 letters sing in less than the 3 s to the next line: the cap ends the fill sooner.
    expect(words[2]!.end).toBeCloseTo(30 + 13 * SECONDS_PER_LETTER);
    expect(wordProgress(words[0]!.start, words[0]!.end, 30)).toBe(0);
    expect(wordProgress(words[0]!.start, words[0]!.end, 40)).toBe(1);
  });

  it('progress is 0 before, 1 after, and linear between', () => {
    expect(wordProgress(1, 3, 0)).toBe(0);
    expect(wordProgress(1, 3, 2)).toBe(0.5);
    expect(wordProgress(1, 3, 5)).toBe(1);
    // A word with no length is lit as soon as it starts.
    expect(wordProgress(2, 2, 2)).toBe(1);
  });
});
