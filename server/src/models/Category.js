import mongoose from 'mongoose';

// docs/03 §3.3 `categories`. A category with userId null is a system template (the admin manages those);
// on register every template is copied to the new user, so each user owns and edits their own copies.
const categorySchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    type: { type: String, enum: ['expense', 'income'], required: true },
    name: { type: String, trim: true, maxlength: 40 }, // set for user-made categories, or when a user renames a copy
    names: { vi: String, en: String }, // templates and their copies: shown in the UI language
    keywords: { type: [String], default: [] }, // lower-case without diacritics, matched by the bot parser
    icon: { type: String, default: '' },
    color: { type: String, default: '' },
    isFallback: { type: Boolean, default: false }, // "Khác / Other": gets the transactions of deleted categories
    deletedAt: { type: Date, default: null },
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

categorySchema.index({ userId: 1, type: 1, deletedAt: 1 });

export const Category = mongoose.model('Category', categorySchema);
