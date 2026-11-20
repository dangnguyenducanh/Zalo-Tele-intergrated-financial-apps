import mongoose from 'mongoose';

// docs/03 §3.3 `budgets`: a spending limit for one expense category, or for all spending when categoryId is
// null, in one Vietnamese month. How much is spent is not stored: services/budgets.js sums the expenses.
// A budget is deleted for real (no deletedAt), so its month and category can be budgeted again.
const budgetSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    categoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', default: null }, // null = overall budget
    month: { type: String, required: true, match: /^\d{4}-(0[1-9]|1[0-2])$/ }, // 'YYYY-MM' in Vietnam time
    limit: { type: Number, required: true, validate: (v) => Number.isSafeInteger(v) && v > 0 }, // whole VND
  },
  {
    timestamps: true,
    toJSON: {
      versionKey: false,
      transform: (doc, ret) => {
        ret.id = String(ret._id);
        delete ret._id;
        return ret;
      },
    },
  },
);

// One budget per category per month, and one overall budget (categoryId null) per month → 409 BUDGET_EXISTS.
budgetSchema.index({ userId: 1, month: 1, categoryId: 1 }, { unique: true });

export const Budget = mongoose.model('Budget', budgetSchema);
