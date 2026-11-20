import { expect, test } from 'vitest';
import { qrMatrix, reedSolomon } from './qrCode';

const draw = (matrix: boolean[][]) => matrix.map((row) => row.map((dark) => (dark ? '#' : '.')).join(''));

test('TC-F7-07 QR encoder: "HELLO" gives the exact symbol of a reference encoder; links pick the smallest version', () => {
  // The same modules as the `qrcode` npm package with mode byte, level L, mask 0 (checked when this encoder was
  // written, together with a jsQR decode of versions 1–5). Finders in three corners, timing lines on row/column 6.
  expect(draw(qrMatrix('HELLO'))).toEqual([
    '#######..#.##.#######',
    '#.....#..###..#.....#',
    '#.###.#.##.##.#.###.#',
    '#.###.#..#.#..#.###.#',
    '#.###.#...#.#.#.###.#',
    '#.....#.....#.#.....#',
    '#######.#.#.#.#######',
    '........##.##........',
    '###.########.##...#..',
    '...#....#.....#....#.',
    '#.#...#...#.#...#####',
    '##..#...#.#...#....#.',
    '#.#..##..##.#.#.#.#..',
    '........##.#.#.#..##.',
    '#######.#..#.###..###',
    '#.....#.######.##....',
    '#.###.#.#..#.###..###',
    '#.###.#...#...##..##.',
    '#.###.#.###.#...#.#.#',
    '#.....#.##....#.#..#.',
    '#######.##..#.##..###',
  ]);

  // Reed–Solomon textbook example (ISO 18004 annex I): "01234567" at version 1-M → its 10 EC codewords.
  expect(reedSolomon([16, 32, 12, 86, 97, 128, 236, 17, 236, 17, 236, 17, 236, 17, 236, 17], 10)).toEqual([
    165, 36, 212, 193, 237, 54, 199, 135, 44, 85,
  ]);

  // A deep link with a 6-character code fits version 3 (29 × 29); even a 32-character bot name fits version 5.
  expect(qrMatrix('https://t.me/test_bot?start=ABC234')).toHaveLength(29);
  expect(qrMatrix(`https://t.me/${'b'.repeat(32)}?start=ABC234`).length).toBeLessThanOrEqual(37);
  expect(() => qrMatrix('x'.repeat(107))).toThrow('Text too long');
});
