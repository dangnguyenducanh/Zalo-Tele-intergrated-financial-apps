// Every reply the bots send, in English. Same keys as messages.vi.js.
const paceDaily = (perDay) => `at most ${perDay} a day`; // the daily limit, the same words as the Budgets chip (client i18n budgets.pace)
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export default {
  locale: 'en-US',
  pleaseLink: (appUrl) => `Please link your account: open ${appUrl}/bot and send /link CODE`,
  tapToLink: (url) => `Or tap to link: ${url} (valid 10 minutes)`,
  invalidCode: 'This link code is wrong or has expired. Create a new one on the Bot page.',
  linked: (name) => `✅ Linked to the account of ${name}. Try sending: coffee 30k`,
  alreadyLinked: 'This chat account is already linked to a web account. Unlink it on the Bot page before using another code.',
  locked: 'Your web account is locked, so the bot will not record anything.',
  help: [
    'Send one item per line, for example:',
    'coffee 30k',
    'grab 32k yesterday mm',
    '+salary 15tr',
    'A question (e.g. /hoi how much did I spend on food this month) is never recorded as an expense.',
    'Split a bill: "dinner 1tr2 chia 4", or send "chia 3" while a draft is waiting.',
    'Quick fix: "/sua 50k", "/sua mm yesterday", "/sua food" (amount, wallet, date, category). Send "hoàn tác" (or "undo") to delete the last saved item, "khôi phục" if that was a mistake.',
    'Commands: /today, /month, /dubao (budget forecast), /hoi (a question), /sua (fix), /lang vi|en, /help',
  ].join('\n'),
  expense: 'Expense',
  income: 'Income',
  draft: (summary) => `📝 ${summary}`,
  replyHint: 'Reply "ok" to save, "huy" to discard, or just the right amount (e.g. 55k) to correct it.',
  nextPending: (summary) => `⏭️ Next draft waiting: ${summary}`,
  buttons: { save: '✅ Save', discard: '❌ Discard', edit: '✏️ Edit' },
  readingReceipt: '🧾 Reading receipt…',
  receiptItems: ({ count, reconciled }) => `🧾 ${count} line items · ${reconciled ? 'they add up to the total' : 'they do not add up to the total, please check'}`,
  receiptUnavailable: "Couldn't read the receipt because the receipt reader is not answering. Please type the amount, e.g. groceries 125k",
  noAmountLines: ({ lines, max }) => `⚠️ Line ${lines} not recorded: no amount I could read (at most ${max}), e.g. coffee 30k`,
  receiptUnreadable: "Couldn't find a total on this photo. Please type the amount, e.g. groceries 125k",
  saved: (summary) => `✅ Saved: ${summary}`,
  discarded: (summary) => `❌ Discarded: ${summary}`,
  notFound: 'This draft was not found.',
  alreadyConfirmed: 'This one is already saved.',
  nothingPending: 'There is no draft waiting.',
  overallBudget: 'Overall',
  // `daily` (the daily limit, docs/02 §2.11.2 A2) is null before day 5 and once the limit is reached.
  budgetWarning: ({ name, percent, spent, limit, over, daily }) =>
    (over ? `🚨 Over the "${name}" budget: ${percent}% (${spent} / ${limit})` : `⚠️ The "${name}" budget is ${percent}% used (${spent} / ${limit})`) +
    (daily ? ` · ${paceDaily(daily)}` : ''),
  today: ({ date, expense, income }) => `📅 Today ${date}\nSpent: ${expense}\nReceived: ${income}`,
  month: ({ month, expense, income, budget, categoryBudgets }) =>
    [
      `📅 Month ${month}`,
      `Spent: ${expense}`,
      `Received: ${income}`,
      budget && `Budget: ${budget.percent}% (${budget.spent} / ${budget.limit})${budget.daily ? ` · ${paceDaily(budget.daily)}` : ''}`,
      ...categoryBudgets.map((b) => `"${b.name}" budget: ${b.percent}% (${b.spent} / ${b.limit})${b.daily ? ` · ${paceDaily(b.daily)}` : ''}`),
    ]
      .filter(Boolean)
      .join('\n'),
  // /dubao (docs/02 §2.11.2 A2). `perDay` is null once the limit is reached; `overDate` is null when the month never goes over.
  paceHeader: ({ month, day, daysInMonth }) => `📊 Forecast for ${month} (day ${day} of ${daysInMonth})`,
  paceOverall: ({ name, spent, limit, left, daysLeft, perDay, projectedEnd, overDate }) =>
    `${name}: spent ${spent} of ${limit}. ` +
    (perDay === null ? 'Over budget. ' : `${left} left for ${daysLeft} ${daysLeft === 1 ? 'day' : 'days'} → ${paceDaily(perDay)}. `) +
    `At this pace the month ends at about ${projectedEnd}${overDate ? `, over around ${overDate}` : ''}.`,
  paceCategory: ({ name, perDay, projectedEnd, overDate }) =>
    `${name}: ${perDay === null ? 'over budget' : paceDaily(perDay)}` + (overDate ? `. Month end about ${projectedEnd}, over around ${overDate}` : '') + '.',
  paceDate: (day, month) => `${MONTHS[month - 1]} ${day}`,
  paceTooEarly: ({ day, from }) => `The forecast starts on day ${from} of the month (today is day ${day}): a few days of spending is too little to go on.`,
  paceNoBudget: 'There is no budget for this month, so there is nothing to forecast. Set one on the Budgets page of the web app.',
  languageSet: 'Switched to English.',
  nothingToSplit: 'There is no draft waiting to split. Send the item first, e.g. dinner 1tr2 chia 4',
  fixed: (summary) => `✏️ Fixed: ${summary}`,
  nothingToFix: 'Nothing to fix: no draft is waiting and nothing was saved from this chat in the last 15 minutes.',
  undone: (summary) => `🗑️ Deleted the item you just saved: ${summary}. Send "khôi phục" if that was a mistake.`,
  nothingToUndo: 'There is nothing saved from this chat to undo.',
  restored: (summary) => `♻️ Restored: ${summary}`,
  nothingToRestore: 'There is nothing undone to restore.',
  hintBig: ({ name, times, median }) => `⚠️ ${times} times your usual "${name}" amount (${median}). A typo?`,
  hintDuplicate: ({ name }) => `⚠️ Same amount as a recent "${name}" entry in the last 10 minutes. Entered twice?`,
  offerTap: '❓ Category unclear. Pick one and I will file it myself next time:',
  offerType: (names) => `❓ Category unclear. Type the name of a category so I remember it: ${names}`,
  learned: ({ name, word }) => `Moved to ${name} and remembered "${word}". Next time I file it myself (edit it on the Categories page).`,
  moved: ({ name }) => `Moved to ${name}.`,
  hasCategory: 'This one already has a category.',
  // The reply to a bare 1-3 (or an old button) once the assistant's "which one?" ran out (docs/02 §2.11.3): never a draft.
  askBackExpired: 'That question has expired, please ask it again',
};
