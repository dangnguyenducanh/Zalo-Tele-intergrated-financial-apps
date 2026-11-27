// Every reply the bots send, in Vietnamese. messages.en.js has the same keys in English.
// Amounts and dates arrive already formatted for `locale` by core.js.
const paceDaily = (perDay) => `tối đa ${perDay}/ngày`; // the daily limit, the same words as the Budgets chip (client i18n budgets.pace)
const dd = (n) => String(n).padStart(2, '0');

export default {
  locale: 'vi-VN',
  pleaseLink: (appUrl) => `Vui lòng liên kết tài khoản: mở ${appUrl}/bot rồi gửi /link MÃ`,
  tapToLink: (url) => `Hoặc bấm để liên kết: ${url} (hiệu lực 10 phút)`,
  invalidCode: 'Mã liên kết không đúng hoặc đã hết hạn. Hãy tạo mã mới trên trang Bot.',
  linked: (name) => `✅ Đã liên kết với tài khoản ${name}. Thử gửi: phở 45k`,
  alreadyLinked: 'Tài khoản chat này đã liên kết với một tài khoản web. Huỷ liên kết trên trang Bot trước khi dùng mã khác.',
  locked: 'Tài khoản web của bạn đang bị khoá nên bot không ghi gì cả.',
  help: [
    'Gửi mỗi khoản trên một dòng, ví dụ:',
    'phở 45k',
    'grab 32k hôm qua mm',
    '+lương 15tr',
    'Câu hỏi (ví dụ: /hoi tháng này ăn uống hết bao nhiêu) không được ghi thành khoản chi.',
    'Lệnh: /today (hôm nay), /month (tháng này), /dubao (dự báo ngân sách), /hoi (câu hỏi), /lang vi|en, /help',
  ].join('\n'),
  expense: 'Chi',
  income: 'Thu',
  draft: (summary) => `📝 ${summary}`,
  replyHint: 'Trả lời "ok" để lưu, "huy" để huỷ, hoặc chỉ số tiền đúng (ví dụ 55k) để sửa.',
  nextPending: (summary) => `⏭️ Khoản nháp tiếp theo đang chờ: ${summary}`,
  buttons: { save: '✅ Lưu', discard: '❌ Huỷ', edit: '✏️ Sửa' },
  readingReceipt: '🧾 Đang đọc hoá đơn…',
  receiptItems: ({ count, reconciled }) => `🧾 ${count} dòng hàng · ${reconciled ? 'cộng lại khớp tổng tiền' : 'cộng lại không khớp tổng tiền, hãy kiểm tra'}`,
  receiptUnavailable: 'Chưa đọc được hoá đơn vì dịch vụ đọc hoá đơn không phản hồi. Hãy gõ số tiền, ví dụ: siêu thị 125k',
  noAmountLines: ({ lines, max }) => `⚠️ Chưa ghi dòng ${lines}: không đọc được số tiền (tối đa ${max}), ví dụ: phở 45k`,
  receiptUnreadable: 'Không tìm thấy tổng tiền trên ảnh này. Hãy gõ số tiền, ví dụ: siêu thị 125k',
  saved: (summary) => `✅ Đã lưu: ${summary}`,
  discarded: (summary) => `❌ Đã huỷ: ${summary}`,
  notFound: 'Không tìm thấy khoản nháp này.',
  alreadyConfirmed: 'Khoản này đã được lưu rồi.',
  nothingPending: 'Không có khoản nháp nào đang chờ.',
  overallBudget: 'Tổng',
  // `daily` (the daily limit, docs/02 §2.11.2 A2) is null before day 5 and once the limit is reached.
  budgetWarning: ({ name, percent, spent, limit, over, daily }) =>
    (over ? `🚨 Vượt ngân sách "${name}": ${percent}% (${spent} / ${limit})` : `⚠️ Ngân sách "${name}" đã dùng ${percent}% (${spent} / ${limit})`) +
    (daily ? ` · ${paceDaily(daily)}` : ''),
  today: ({ date, expense, income }) => `📅 Hôm nay ${date}\nChi: ${expense}\nThu: ${income}`,
  month: ({ month, expense, income, budget, categoryBudgets }) =>
    [
      `📅 Tháng ${month}`,
      `Chi: ${expense}`,
      `Thu: ${income}`,
      budget && `Ngân sách: ${budget.percent}% (${budget.spent} / ${budget.limit})${budget.daily ? ` · ${paceDaily(budget.daily)}` : ''}`,
      ...categoryBudgets.map((b) => `Ngân sách "${b.name}": ${b.percent}% (${b.spent} / ${b.limit})${b.daily ? ` · ${paceDaily(b.daily)}` : ''}`),
    ]
      .filter(Boolean)
      .join('\n'),
  // /dubao (docs/02 §2.11.2 A2). `perDay` is null once the limit is reached; `overDate` is null when the month never goes over.
  paceHeader: ({ month, day, daysInMonth }) => `📊 Dự báo tháng ${month} (ngày ${day}/${daysInMonth})`,
  paceOverall: ({ name, spent, limit, left, daysLeft, perDay, projectedEnd, overDate }) =>
    `${name}: đã chi ${spent} / ${limit}. ` +
    (perDay === null ? 'Đã vượt ngân sách. ' : `Còn ${left} cho ${daysLeft} ngày → ${paceDaily(perDay)}. `) +
    `Theo nhịp này cuối tháng ≈ ${projectedEnd}${overDate ? `, vượt khoảng ${overDate}` : ''}.`,
  paceCategory: ({ name, perDay, projectedEnd, overDate }) =>
    `${name}: ${perDay === null ? 'đã vượt ngân sách' : paceDaily(perDay)}` + (overDate ? `. Cuối tháng ≈ ${projectedEnd}, vượt khoảng ${overDate}` : '') + '.',
  paceDate: (day, month) => `${dd(day)}/${dd(month)}`,
  paceTooEarly: ({ day, from }) => `Dự báo chỉ có từ ngày ${from} của tháng (hôm nay là ngày ${day}): mới vài ngày thì chưa đủ số liệu để đoán.`,
  paceNoBudget: 'Tháng này chưa có ngân sách nên chưa có gì để dự báo. Hãy đặt ngân sách trên trang Ngân sách của web.',
  languageSet: 'Đã chuyển sang tiếng Việt.',
};
