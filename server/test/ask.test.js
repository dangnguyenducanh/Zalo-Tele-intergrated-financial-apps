import { describe, expect, test } from 'vitest';
import { classify, classifyWithRule } from '../src/bot/ask.js';

// docs/02 §2.11.1: the first rule that fires decides. Each row is [text, followUp, answer, rule that decided].
const row = (text, answer, rule, followUp = false) => [text, followUp, answer, rule];

describe('TC-F14-24 classify: a row per rule of docs/02 §2.11.1, in order', () => {
  test.each([
    // 1. starts with "?"
    row('?phở 45k', 'question', '1'),
    row('? tháng này ăn uống hết bao nhiêu', 'question', '1'),
    // 2. more than one non-empty line
    row('tháng 10 thu bao nhiêu\nhôm qua chi bao nhiêu', 'capture', '2'),
    row('phở 45k\n\ngrab 32k', 'capture', '2'),
    row('còn tháng trước\ntổng kết tuần', 'capture', '2', true), // even in a follow-up
    row('phở 45k?\n?grab 32k', 'capture', '2'),
    // 3. ends with "?", even with an amount
    row('phở 45k?', 'question', '3'),
    row('hôm nay ăn gì?', 'question', '3'),
    row('45k có nhiều không ?', 'question', '3'),
    // 4. last word chưa / không / ko, or "bao nhiêu" anywhere
    row('tháng 10 thu bao nhiêu', 'question', '4'),
    row('tháng 3 năm 2025 tiêu bao nhiêu', 'question', '4'),
    row('7 ngày qua tiêu bao nhiêu', 'question', '4'),
    row('45k là nhiều chưa', 'question', '4'),
    row('momo còn bao nhiêu', 'question', '4'),
    row('thang nay an uong het bao nhieu', 'question', '4'), // without accents
    row('tháng này tiêu nhiều không', 'question', '4'),
    row('tháng này ăn ngoài nhiều ko', 'question', '4'),
    row('phở 45k bao nhiêu', 'question', '4'), // rule 4 comes before the amount of rule 5
    row('cà phê không đường 25', 'capture', '8'), // "không" is not the last word
    // 5. an explicit amount, once time words and counts are out of the way
    row('phở 45k', 'capture', '5'),
    row('sửa xe 150k', 'capture', '5'),
    row('cơm 1tr2', 'capture', '5'),
    row('phở 45 k', 'capture', '5'),
    row('grab 150.000', 'capture', '5'),
    row('lương 15000000', 'capture', '5'),
    row('thuê nhà năm 2026 36tr', 'capture', '5'),
    row('chi 7 ngày qua 150k', 'capture', '5'),
    row('ăn tối tháng 10k', 'capture', '5'), // a unit makes the 10 money
    row('ăn tối tháng 10 k', 'capture', '5'),
    row('phở 45k', 'capture', '5', true), // a follow-up never turns a typed amount into a question
    row('thuê nhà năm 2026 36tr', 'capture', '5', true),
    // 5b. top N or N khoản, and no other number left
    row('5 khoản chi lớn nhất tuần trước', 'question', '5b'),
    row('top 3 cafe', 'question', '5b'),
    row('Top 5 chi tiêu tháng 10', 'question', '5b'),
    row('10 khoản gần nhất', 'question', '5b'),
    row('top 3 cafe 50', 'capture', '8'), // another number is left: not a question
    row('top 3 cafe 50k', 'capture', '5'),
    // 6. strong question markers
    row('khi nào hết tiền', 'question', '6'),
    row('bao giờ lương về', 'question', '6'),
    row('chi tiêu thế nào', 'question', '6'),
    row('tại sao tháng này tiêu nhiều', 'question', '6'),
    row('vi sao thang nay tieu nhieu', 'question', '6'),
    row('tổng kết tuần trước', 'question', '6'),
    row('so với tháng trước', 'question', '6'),
    row('how much did I spend', 'question', '6'),
    row('why so high', 'question', '6'),
    row('sao tháng này tiêu nhiều vậy', 'question', '6'), // "sao" first
    row('tháng này tiêu nhiều vậy sao', 'question', '6'), // "sao" last
    row('tháng này tiêu mấy lần', 'question', '6'), // "mấy" with its diacritics
    row('may 50', 'capture', '8'), // without diacritics it is "may"
    row('mua sao biển 50', 'capture', '8'), // "sao" in the middle is a word like any other
    // 6, weak cues: only at the start, and only when no number is left, not even a bare one
    row('tìm phở', 'question', '6'),
    row('top cafe', 'question', '6'),
    row('còn lại tháng này', 'question', '6'),
    row('tìm phở tháng 10', 'question', '6'), // the month is a date, not a number left over
    row('tim heo 50', 'capture', '8'), // no accent on "tim", and a bare number
    row('tìm phở 45', 'capture', '8'), // a bare number is left
    row('crop top 120', 'capture', '8'), // "top" is not the first word
    // 7. a follow-up with no explicit amount (D11: a bare number is not an amount)
    row('còn tháng trước', 'question', '7', true),
    row('phở 45', 'question', '7', true),
    row('còn 3 tháng trước', 'question', '7', true),
    row('cà phê', 'question', '7', true),
    row('ăn tối tháng 10 50', 'question', '7', true),
    // 8. anything else is a capture; a bare number is still guessed as thousands, no amount gives the help text
    row('phở 45', 'capture', '8'),
    row('còn 3 tháng trước', 'capture', '8'),
    row('cà phê không đường 25', 'capture', '8'),
    row('ăn tối tháng 10 50', 'capture', '8'),
    row('hello bot', 'capture', '8'),
    row('chi tiêu 7 ngày qua', 'capture', '8'), // drafts nothing: the 7 is no amount, so the parser finds none
    row('đã chi gì tháng 9', 'capture', '8'),
    row('chi tiêu năm 2025', 'capture', '8'),
    row('đã mua gì ở Circle K tháng này', 'capture', '8'), // still needs "?" or /hoi (docs/07 §7.9.11)
    row('trả 500 ngay', 'capture', '8'),
    row('', 'capture', '8'),
  ])('TC-F14-24 "%s" (followUp %s) → %s by rule %s', (text, followUp, answer, rule) => {
    expect(classifyWithRule(text, { followUp })).toEqual({ answer, rule });
    expect(classify(text, { followUp })).toBe(answer);
  });

  test('TC-F14-24 followUp is false when it is left out', () => {
    expect(classify('phở 45')).toBe('capture');
    expect(classify('phở 45', {})).toBe('capture');
    expect(classify('phở 45', { followUp: true })).toBe('question');
  });

  test('TC-F14-24 surrounding spaces and a missing text change nothing', () => {
    expect(classify('  ?phở 45k  ')).toBe('question');
    expect(classify('  phở 45k  ')).toBe('capture');
    expect(classify(undefined)).toBe('capture');
    expect(classify(undefined, { followUp: true })).toBe('question');
  });

  test('TC-F14-24 the accents that matter are checked on the typed word, in either Unicode form', () => {
    expect(classify('tìm phở')).toBe('question');
    expect(classify('tìm phở')).toBe('question'); // "tìm" typed as i + combining grave
    expect(classify('tuần này tiêu mấy lần')).toBe('question'); // "mấy" in NFD
    expect(classify('tim phở')).toBe('capture');
  });
});

// BUG-044: "/hoi …" is the question command of the chat bots (docs/02 §2.11.1 row 3); QuickAdd and the parse route only run classify.
describe('TC-F14-57 classify: a text whose first word is the /hoi command is a question', () => {
  test.each([
    ['/hoi phở 45k', 'question'],
    ['/hỏi phở 45k', 'question'],
    ['/Hoi phở 45k', 'question'],
    ['/HỎI phở 45k', 'question'],
    ['/ho\u0309i phở 45k', 'question'], // "ỏ" as o + combining hook (NFD)
    ['  /hoi  tháng này ăn uống hết bao nhiêu', 'question'],
    ['/hoi', 'question'],
    ['/hoi@my_bot phở 45k', 'question'],
    ['/hoi phở 45k\ngrab 32k', 'question'], // the router takes "/hoi" before anything else, whatever follows
    ['/hoiphở 45k', 'capture'], // one word, not the command
    ['/hoi_phở 45k', 'capture'],
    ['hoi phở 45k', 'capture'], // no slash
    ['phở 45k /hoi', 'capture'], // not the first word
    ['/today', 'capture'], // another command is not a question
  ])('TC-F14-57 "%s" → %s', (text, answer) => {
    expect(classify(text)).toBe(answer);
    if (answer === 'question') expect(classifyWithRule(text, { followUp: true }).answer).toBe('question');
  });
});

// Every message the parser tests read as money, with no follow-up (docs/02 §2.11.8 "capture is unchanged").
describe('TC-F14-24 classify: every text the parser reads as an expense or income is still a capture', () => {
  test.each([
    ...['45k', '45 k', '45 nghìn', '45 ngàn', '45ng', '1tr', '1 triệu', '1m', '1tr2', '1tr25', '1.5tr', '1,5tr', '150.000', '150,000', '150000', '150000đ', '150000 vnd', '45'].map(
      (written) => `phở ${written}`,
    ),
    '+lương 15tr',
    '+ 500k',
    'thưởng tết 2tr',
    'nhận 200k',
    'salary 15tr',
    'bonus 1tr',
    'received 300k',
    'lì xì 500k',
    'PHỞ BÒ 45k',
    'bánh mì 20k',
    'coffee 30k',
    'grab 32k',
    'gửi xe 5k',
    'sửa xe 200k',
    'tiền nhà 3tr',
    'abc 45k',
    'bunker 45k',
    'phở 45k mm',
    'phở 45k BANK',
    'phở 45k hôm qua',
    'phở 45k hqua',
    'phở 45k yesterday',
    'phở 45k 15/11',
    'phở 45k 15/11/2025',
    'grab 32k hôm qua mm',
    'Cà phê Highlands 55k tm hôm qua',
    '2 ly trà sữa 50k',
    '1tr25',
    '45',
    'cafe 10000000000000',
    'cafe 20000000000000',
    'thuê nhà năm 2026 36tr',
    'học phí năm 2025 12.000.000',
    'bảo hiểm năm 2026 1500000',
    'ăn tối tháng 10 50',
    'thuê nhà 36tr năm 2026',
    'tiền nhà tháng 11 5tr',
    'ăn tối tháng 10 50k',
    'cắt tóc nam 50k',
    'cắt tóc nam 50000',
    'áo nam 2000k',
    'gửi xe tháng 100k',
    'gửi xe tháng 100',
    'thuê nhà tháng 13',
    'ăn tối tháng 10k',
    'ăn tối tháng 10 k',
    'ăn tối tháng 10 nghìn',
    'thuê nhà năm 2.026',
    'học phí năm 1899',
    'học phí năm 2100',
    'tiền nhà tháng 10', // no amount: still a capture, and the parser answers with the help text
    'năm 2025',
    'phở 45k, grab 32k',
    'trả 500 ngay',
    'tim heo 50',
    'crop top 120',
    'may 50',
    'cà phê không đường 25',
    'sửa xe 150k',
  ])('TC-F14-24 "%s" is a capture', (text) => {
    expect(classify(text, { followUp: false })).toBe('capture');
  });
});
