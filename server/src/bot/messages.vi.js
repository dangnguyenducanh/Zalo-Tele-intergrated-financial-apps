// Every reply the bots send, in Vietnamese. messages.en.js has the same keys in English.
// Amounts and dates arrive already formatted for `locale` by core.js.
export default {
  locale: 'vi-VN',
  pleaseLink: (appUrl) => `Vui lòng liên kết tài khoản: mở ${appUrl}/bot rồi gửi /link MÃ`,
  invalidCode: 'Mã liên kết không đúng hoặc đã hết hạn. Hãy tạo mã mới trên trang Bot.',
  linked: (name) => `✅ Đã liên kết với tài khoản ${name}. Thử gửi: phở 45k`,
  alreadyLinked: 'Tài khoản chat này đã liên kết với một tài khoản web. Huỷ liên kết trên trang Bot trước khi dùng mã khác.',
  locked: 'Tài khoản web của bạn đang bị khoá nên bot không ghi gì cả.',
  help: [
    'Gửi mỗi khoản trên một dòng, ví dụ:',
    'phở 45k',
    'grab 32k hôm qua mm',
    '+lương 15tr',
    'Lệnh: /today (hôm nay), /month (tháng này), /lang vi|en, /help',
  ].join('\n'),
  expense: 'Chi',
  income: 'Thu',
  draft: (summary) => `📝 ${summary}`,
  replyHint: 'Trả lời "ok" để lưu hoặc "huy" để huỷ.',
  buttons: { save: '✅ Lưu', discard: '❌ Huỷ', edit: '✏️ Sửa' },
  saved: (summary) => `✅ Đã lưu: ${summary}`,
  discarded: (summary) => `❌ Đã huỷ: ${summary}`,
  notFound: 'Không tìm thấy khoản nháp này.',
  alreadyConfirmed: 'Khoản này đã được lưu rồi.',
  nothingPending: 'Không có khoản nháp nào đang chờ.',
  overallBudget: 'Tổng',
  budgetWarning: ({ name, percent, spent, limit, over }) =>
    over ? `🚨 Vượt ngân sách "${name}": ${percent}% (${spent} / ${limit})` : `⚠️ Ngân sách "${name}" đã dùng ${percent}% (${spent} / ${limit})`,
  today: ({ date, expense, income }) => `📅 Hôm nay ${date}\nChi: ${expense}\nThu: ${income}`,
  month: ({ month, expense, income, budget }) =>
    [`📅 Tháng ${month}`, `Chi: ${expense}`, `Thu: ${income}`, budget && `Ngân sách: ${budget.percent}% (${budget.spent} / ${budget.limit})`]
      .filter(Boolean)
      .join('\n'),
  languageSet: 'Đã chuyển sang tiếng Việt.',
};
