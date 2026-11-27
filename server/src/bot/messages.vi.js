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
    'Chia hoá đơn: "cơm 1tr2 chia 4", hoặc gửi "chia 3" khi có khoản nháp đang chờ.',
    'Sửa nhanh: "/sua 50k", "/sua mm hôm qua", "/sua ăn uống" (số tiền, ví, ngày, danh mục). Gõ "hoàn tác" để xoá khoản vừa lưu, "khôi phục" nếu xoá nhầm.',
    'Lệnh: /today (hôm nay), /month (tháng này), /dubao (dự báo ngân sách), /hoi (câu hỏi), /sua (sửa), /lang vi|en, /help',
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
  nothingToSplit: 'Không có khoản nháp nào đang chờ để chia. Hãy gửi khoản trước, ví dụ: cơm 1tr2 chia 4',
  fixed: (summary) => `✏️ Đã sửa: ${summary}`,
  nothingToFix: 'Không có khoản nào để sửa: không có khoản nháp đang chờ và không có khoản nào vừa lưu trong 15 phút qua.',
  undone: (summary) => `🗑️ Đã xoá khoản vừa lưu: ${summary}. Gõ "khôi phục" nếu xoá nhầm.`,
  nothingToUndo: 'Không có khoản nào vừa lưu để hoàn tác.',
  restored: (summary) => `♻️ Đã khôi phục: ${summary}`,
  nothingToRestore: 'Không có khoản nào vừa hoàn tác để khôi phục.',
  hintBig: ({ name, times, median }) => `⚠️ Lớn gấp ${times} lần khoản "${name}" thường ngày (${median}). Gõ nhầm?`,
  hintDuplicate: ({ name }) => `⚠️ Giống một khoản "${name}" vừa nhập trong 10 phút qua. Nhập trùng?`,
  offerTap: '❓ Chưa rõ danh mục. Chọn một, lần sau mình tự xếp:',
  offerType: (names) => `❓ Chưa rõ danh mục. Gõ tên một danh mục để mình ghi nhớ: ${names}`,
  learned: ({ name, word }) => `Đã chuyển sang ${name} và ghi nhớ "${word}". Lần sau mình tự xếp (sửa ở trang Danh mục).`,
  moved: ({ name }) => `Đã chuyển sang ${name}.`,
  hasCategory: 'Khoản này đã có danh mục rồi.',
  // The reply to a bare 1-3 (or an old button) once the assistant's "which one?" ran out (docs/02 §2.11.3): never a draft.
  askBackExpired: 'Câu hỏi đã hết hạn, hãy hỏi lại',
};
