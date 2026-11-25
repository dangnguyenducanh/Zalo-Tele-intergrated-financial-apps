// A small QR code encoder (ISO/IEC 18004) for the Telegram deep link, so the Bot inbox needs no QR library.
// It only does what a short link needs: byte mode, error correction level L, versions 1–5 (up to 106 bytes,
// a 21–37 module square). Those versions use one Reed–Solomon block and no version-information area.
// Steps: text → data codewords → error correction codewords → modules (fixed patterns, data, mask, format bits).

const TOTAL_CODEWORDS = [26, 44, 70, 100, 134]; // versions 1–5
const EC_CODEWORDS = [7, 10, 15, 20, 26]; // level L
const MASK = 0; // ponytail: always mask 0, (x + y) even; every reader decodes any mask. Add penalty scoring if a phone struggles.

// Arithmetic in GF(256) with the QR polynomial x⁸ + x⁴ + x³ + x² + 1 (0x11d), through log/antilog tables.
const EXP: number[] = []; // EXP[i] = α^i
const LOG: number[] = []; // LOG[α^i] = i
for (let i = 0, x = 1; i < 255; i++) {
  EXP[i] = x;
  LOG[x] = i;
  x <<= 1; // multiply by α
  if (x & 0x100) x ^= 0x11d; // and reduce modulo the polynomial
}
const multiply = (a: number, b: number) => (a && b ? EXP[(LOG[a]! + LOG[b]!) % 255]! : 0);

// The `degree` error correction codewords for `data`: the remainder of data(x)·x^degree divided by the
// generator polynomial (x − α⁰)(x − α¹)…(x − α^(degree−1)).
export function reedSolomon(data: number[], degree: number): number[] {
  let generator = [1]; // coefficients, highest power first
  for (let i = 0; i < degree; i++) {
    generator = [...generator, 0].map((c, j) => c ^ multiply(generator[j - 1] ?? 0, EXP[i]!));
  }
  const remainder: number[] = new Array<number>(degree).fill(0);
  for (const byte of data) {
    const factor = byte ^ remainder.shift()!;
    remainder.push(0);
    for (let j = 0; j < degree; j++) remainder[j]! ^= multiply(generator[j + 1]!, factor);
  }
  return remainder;
}

// Mode "byte" (0100), an 8-bit length, the bytes, up to 4 zero bits, then pad bytes 0xEC 0x11 … to fill the version.
function dataCodewords(bytes: Uint8Array, capacity: number): number[] {
  const bits: number[] = [];
  const push = (value: number, length: number) => {
    for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  push(0b0100, 4);
  push(bytes.length, 8);
  bytes.forEach((byte) => push(byte, 8));
  push(0, Math.min(4, capacity * 8 - bits.length));
  push(0, (8 - (bits.length % 8)) % 8);
  const codewords = Array.from({ length: bits.length / 8 }, (_, i) => parseInt(bits.slice(i * 8, i * 8 + 8).join(''), 2));
  for (let pad = 0xec; codewords.length < capacity; pad ^= 0xec ^ 0x11) codewords.push(pad);
  return codewords;
}

// The 15 format bits: level L (01) and the mask number, protected by a BCH code, then XOR 0x5412.
function formatBits(): number {
  const data = (0b01 << 3) | MASK;
  let rest = data;
  for (let i = 0; i < 10; i++) rest = (rest << 1) ^ ((rest >>> 9) * 0x537);
  return ((data << 10) | rest) ^ 0x5412;
}

// text → a square of modules, true = dark, without the quiet zone. Throws if the text is longer than 106 bytes.
export function qrMatrix(text: string): boolean[][] {
  const bytes = new TextEncoder().encode(text);
  const v = TOTAL_CODEWORDS.findIndex((total, i) => total - EC_CODEWORDS[i]! - 2 >= bytes.length);
  if (v < 0) throw new Error('Text too long for this QR encoder');
  const data = dataCodewords(bytes, TOTAL_CODEWORDS[v]! - EC_CODEWORDS[v]!);
  const codewords = [...data, ...reedSolomon(data, EC_CODEWORDS[v]!)];

  const size = 21 + 4 * v;
  const dark = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const fixed = Array.from({ length: size }, () => new Array<boolean>(size).fill(false)); // not data: never masked
  const set = (x: number, y: number, on: boolean) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    dark[y]![x] = on;
    fixed[y]![x] = true;
  };

  // Timing lines, the three finder squares (with their light border), and the alignment square (versions 2+).
  for (let i = 0; i < size; i++) {
    set(6, i, i % 2 === 0);
    set(i, 6, i % 2 === 0);
  }
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]] as const) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const ring = Math.max(Math.abs(dx), Math.abs(dy));
        set(cx + dx, cy + dy, ring !== 2 && ring !== 4);
      }
    }
  }
  if (v > 0) {
    const c = size - 7;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(c + dx, c + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }

  // Format bits, twice (next to the top-left finder, and split between the other two), plus the one dark module.
  const format = formatBits();
  const bit = (i: number) => ((format >>> i) & 1) === 1;
  for (let i = 0; i <= 5; i++) set(8, i, bit(i));
  set(8, 7, bit(6));
  set(8, 8, bit(7));
  set(7, 8, bit(8));
  for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
  for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
  for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
  set(8, size - 8, true);

  // Data bits in two-column strips from the bottom-right corner, zig-zagging up and down, skipping column 6.
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    const upward = ((right + 1) & 2) === 0;
    for (let step = 0; step < size; step++) {
      const y = upward ? size - 1 - step : step;
      for (const x of [right, right - 1]) {
        if (fixed[y]![x]) continue;
        const on = i < codewords.length * 8 && ((codewords[i >>> 3]! >>> (7 - (i & 7))) & 1) === 1;
        dark[y]![x] = on !== ((x + y) % 2 === 0); // mask 0 flips every other module
        i++;
      }
    }
  }
  return dark;
}

// The symbol as one SVG path of 1×1 squares, shifted by a 4-module light margin (the quiet zone); `size` includes it.
export function qrSvgPath(text: string): { size: number; path: string } {
  const modules = qrMatrix(text);
  const path = modules.flatMap((row, y) => row.map((dark, x) => (dark ? `M${x + 4} ${y + 4}h1v1h-1z` : ''))).join('');
  return { size: modules.length + 8, path };
}
