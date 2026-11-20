// Every reply the bots send, in English. Same keys as messages.vi.js.
export default {
  locale: 'en-US',
  pleaseLink: (appUrl) => `Please link your account: open ${appUrl}/bot and send /link CODE`,
  invalidCode: 'This link code is wrong or has expired. Create a new one on the Bot page.',
  linked: (name) => `✅ Linked to the account of ${name}. Try sending: coffee 30k`,
  alreadyLinked: 'This chat account is already linked to a web account. Unlink it on the Bot page before using another code.',
  locked: 'Your web account is locked, so the bot will not record anything.',
  help: [
    'Send one item per line, for example:',
    'coffee 30k',
    'grab 32k yesterday mm',
    '+salary 15tr',
    'Commands: /today, /month, /lang vi|en, /help',
  ].join('\n'),
  expense: 'Expense',
  income: 'Income',
  draft: (summary) => `📝 ${summary}`,
  replyHint: 'Reply "ok" to save or "huy" to discard.',
  buttons: { save: '✅ Save', discard: '❌ Discard', edit: '✏️ Edit' },
  readingReceipt: '🧾 Reading receipt…',
  receiptItems: ({ count, reconciled }) => `🧾 ${count} line items · ${reconciled ? 'they add up to the total' : 'they do not add up to the total, please check'}`,
  receiptUnavailable: "Couldn't read the receipt because the receipt reader is not answering. Please type the amount, e.g. groceries 125k",
  receiptUnreadable: "Couldn't find a total on this photo. Please type the amount, e.g. groceries 125k",
  saved: (summary) => `✅ Saved: ${summary}`,
  discarded: (summary) => `❌ Discarded: ${summary}`,
  notFound: 'This draft was not found.',
  alreadyConfirmed: 'This one is already saved.',
  nothingPending: 'There is no draft waiting.',
  overallBudget: 'Overall',
  budgetWarning: ({ name, percent, spent, limit, over }) =>
    over ? `🚨 Over the "${name}" budget: ${percent}% (${spent} / ${limit})` : `⚠️ The "${name}" budget is ${percent}% used (${spent} / ${limit})`,
  today: ({ date, expense, income }) => `📅 Today ${date}\nSpent: ${expense}\nReceived: ${income}`,
  month: ({ month, expense, income, budget }) =>
    [`📅 Month ${month}`, `Spent: ${expense}`, `Received: ${income}`, budget && `Budget: ${budget.percent}% (${budget.spent} / ${budget.limit})`]
      .filter(Boolean)
      .join('\n'),
  languageSet: 'Switched to English.',
};
