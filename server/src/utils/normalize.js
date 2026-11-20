// Lower-case and strip Vietnamese diacritics, for matching only: "Phở Đà Lạt" → "pho da lat".
export function normalize(text) {
  return String(text ?? '')
    .toLowerCase()
    .normalize('NFD') // "ở" → "o" + combining marks
    .replace(/[̀-ͯ]/g, '') // drop the combining marks
    .replace(/đ/g, 'd') // "đ" is its own letter, not "d" + a mark
    .replace(/\s+/g, ' ')
    .trim();
}
