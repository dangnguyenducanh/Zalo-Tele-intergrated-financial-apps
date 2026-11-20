// Default data every new user starts with (docs/03 §3.5). `npm run seed` stores DEFAULT_CATEGORIES as the
// system templates (userId null) that the admin can edit later; register copies whatever templates exist.
// Icons are Material icon names (the client uses MUI). Keywords are already lower-case without diacritics.
export const DEFAULT_CATEGORIES = [
  {
    type: 'expense',
    names: { vi: 'Ăn uống', en: 'Food & drinks' },
    icon: 'Restaurant',
    color: '#ef6c00',
    keywords: ['pho', 'bun', 'com', 'banh mi', 'cafe', 'ca phe', 'tra sua', 'an sang', 'an trua', 'coffee', 'lunch', 'dinner'],
  },
  {
    type: 'expense',
    names: { vi: 'Đi lại', en: 'Transport' },
    icon: 'DirectionsCar',
    color: '#1976d2',
    keywords: ['grab', 'be', 'xanh sm', 'taxi', 'xang', 'gui xe', 'bus', 've xe', 'parking', 'fuel'],
  },
  {
    type: 'expense',
    names: { vi: 'Mua sắm', en: 'Shopping' },
    icon: 'ShoppingBag',
    color: '#c2185b',
    keywords: ['shopee', 'lazada', 'tiki', 'quan ao', 'giay', 'sieu thi', 'circle k', 'winmart', 'shopping'],
  },
  {
    type: 'expense',
    names: { vi: 'Hoá đơn', en: 'Bills' },
    icon: 'ReceiptLong',
    color: '#5d4037',
    keywords: ['dien', 'nuoc', 'internet', 'wifi', 'dien thoai', '4g', 'electricity', 'water'],
  },
  { type: 'expense', names: { vi: 'Nhà ở', en: 'Housing' }, icon: 'Home', color: '#7b1fa2', keywords: ['tien nha', 'tien tro', 'thue nha', 'rent'] },
  {
    type: 'expense',
    names: { vi: 'Giải trí', en: 'Entertainment' },
    icon: 'Movie',
    color: '#d32f2f',
    keywords: ['phim', 'cgv', 'netflix', 'spotify', 'game', 'movie'],
  },
  {
    type: 'expense',
    names: { vi: 'Sức khoẻ', en: 'Health' },
    icon: 'LocalHospital',
    color: '#00897b',
    keywords: ['thuoc', 'kham', 'benh vien', 'nha khoa', 'pharmacy'],
  },
  { type: 'expense', names: { vi: 'Giáo dục', en: 'Education' }, icon: 'School', color: '#303f9f', keywords: ['sach', 'hoc phi', 'khoa hoc', 'book', 'course'] },
  { type: 'expense', names: { vi: 'Khác', en: 'Other' }, icon: 'Category', color: '#757575', keywords: [], isFallback: true },
  { type: 'income', names: { vi: 'Lương', en: 'Salary' }, icon: 'Payments', color: '#2e7d32', keywords: ['luong', 'salary'] },
  { type: 'income', names: { vi: 'Thưởng', en: 'Bonus' }, icon: 'EmojiEvents', color: '#f9a825', keywords: ['thuong', 'bonus'] },
  { type: 'income', names: { vi: 'Được tặng', en: 'Gifts' }, icon: 'CardGiftcard', color: '#ad1457', keywords: ['li xi', 'qua', 'gift'] },
  { type: 'income', names: { vi: 'Thu khác', en: 'Other income' }, icon: 'Savings', color: '#616161', keywords: ['nhan', 'received'], isFallback: true },
];

// Created on register and set as the user's default wallet; named in the user's language.
export const DEFAULT_WALLET = { names: { vi: 'Tiền mặt', en: 'Cash' }, type: 'cash', aliases: ['tm', 'cash'], icon: 'Payments', color: '#2e7d32' };
