import { readFile } from 'node:fs/promises';
import { expect, test } from 'vitest';
import { env } from '../src/config/env.js';
import { analyzeReceipt, imageType, receiptToDraft } from '../src/services/receipts.js';
import { vnParts } from '../src/utils/vnTime.js';

// KIE contract (docs/07 §7.1): the real KIE service reads the 5 sample receipts of the KIE repo
// (data/test_degraded, copied to fixtures/receipts) and our client maps each answer to a draft.
// It needs a running KIE, so it is skipped when KIE_URL does not answer /health (CI, or KIE stopped). To run it, in server/:
//   KIE_URL=http://127.0.0.1:8290 KIE_API_KEY=<the key in server/.env> npx vitest run test/kie.contract.test.js
const kieIsUp = await fetch(`${env.KIE_URL}/health`, { signal: AbortSignal.timeout(3000) }).then(
  (res) => res.ok,
  () => false,
);

// The total printed on each sample receipt.
const SAMPLES = {
  'mcocr_public_145014cftxo.jpg': 114700,
  'mcocr_public_145014cgzmv.jpg': 169000,
  'mcocr_public_145014jcwux.jpg': 45000,
  'mcocr_public_145014khrvg.jpg': 116000,
  'mcocr_public_145014ykqth.jpg': 124000,
};

test.skipIf(!kieIsUp)(
  'TC-F10-01 real KIE output for the 5 sample receipts maps to drafts: integer total, date or now, merchant as note',
  async () => {
    const now = new Date();
    for (const [name, total] of Object.entries(SAMPLES)) {
      const bytes = await readFile(new URL(`./fixtures/receipts/${name}`, import.meta.url));
      const kie = await analyzeReceipt(bytes, imageType(bytes));
      const draft = receiptToDraft(kie, { categories: [], now });

      expect(draft.amount, name).toBe(total);
      const [day, month, year] = (kie.fields.date ?? '').split('/').map(Number);
      if (year) expect(vnParts(draft.occurredAt), name).toEqual({ year, month, day });
      else expect(draft.occurredAt, name).toBe(now);
      expect(draft.note, name).toBe(kie.fields.merchant.trim());
      expect(draft.receipt.items.length, name).toBe(kie.lineItems.length);
    }
  },
  300_000, // KIE reads one image at a time, 5–20 s each
);
