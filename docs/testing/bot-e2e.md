# Real-chat bot e2e (Telegram + Zalo)

The webhook contract tests (`server/test/telegram.test.js`, `zalo.test.js`) and charters MT-02/MT-03 send **simulated** webhook payloads, so they never see a real chat app, a real bot reply, a real button press or a real photo download. This runbook closes that gap: someone types into the **real** Telegram and Zalo chats with the deployed bots, and [`tools/bot-e2e/bot-e2e.mjs`](../../tools/bot-e2e/bot-e2e.mjs) checks, after each step, that the expected bot replies and buttons are there (extra replies don't fail a step) and that the server state is exactly as expected, using the API. Test cases: TC-F7-08 (linking), TC-F8-16 (Telegram text), TC-F8-17 (Zalo text), TC-F8-18 (real receipts). They sit in the catalogue's feature groups, not under a separate TC-BOT-E2E prefix.

- **Driver:** Claude in Chrome on Telegram Web (`web.telegram.org/a/`) and Zalo Web (`chat.zalo.me`), logged in as the student's own accounts. A person on a phone works the same way.
- **Target:** production (both bots' webhooks point there), with a dedicated e2e web user. **The checker never signs up:** with e-mail codes on, a sign-up would send a code to an address that bounces. Register the user once on the website with an inbox you can read, and save its login as `{"email","password"}` in `~/.config/bot-e2e/<host>.json` (mode 600), never in the repo. Without that file, a command that needs a login makes no network call, prints these instructions with the exact path, and exits 1. Cleanup unlinks its chats and deletes its transactions through the API (a soft delete, like the web's delete: the rows stay in the database with `deletedAt`), so the chats are free to link elsewhere afterwards. `--target` defaults to production. Pass `--target staging` for anything else.
- **Steps:** [`tools/bot-e2e/scenarios.json`](../../tools/bot-e2e/scenarios.json). Each step has the action, the regexes the bot replies must match, the buttons (Telegram), and the exact state afterwards (`links`, `drafts`, `confirmed` as `source:amount` multisets).
- **Evidence:** `charter-runs/<VN date>/bot-e2e/results.jsonl`, one JSON line per checked step. This folder is git-ignored because it holds chat text.

| Step | Chat | Proves |
|---|---|---|
| TG-01 / ZL-01 | `/start CODE` · `/link CODE` | A link code links the real chat account (single-use code from `bot-e2e.mjs code`) |
| TG-02, TG-04 / ZL-02, ZL-04 | `phở 45k`, two lines `grab 32k` + `cafe 25k` / `grab 32k`, `cafe 25k` | Text → one draft per line, with ✅ Lưu / ❌ Huỷ / ✏️ Sửa (Telegram) or the "ok / huy" hint (Zalo) |
| TG-03, TG-05, TG-06 / ZL-03, ZL-05, ZL-06 | ✅ / ❌ buttons · `ok` / `huy` | Confirm and discard change the server; Zalo acts on the pending draft; `ok` with nothing pending is answered |
| TG-07 / ZL-07 | `/today` · `/month` | Totals count confirmed transactions only, across both chats |
| TG-08, TG-09 | `xin chào`, `/start ABC234` | No amount → help, nothing stored; a linked chat refuses a second code |
| ZL-10 … ZL-13 | two lines `an sang 30k` + `tra sua 40k`, then `ok`, `ok`, `ok` | Each `ok` reaches the next waiting draft, newest first, and names the next one; "nothing pending" only when none is left (TC-F8-21, BUG-028) |
| ZL-14 | `bot-e2e.mjs budget "Đi lại" 80000`, then `/month` | `/month` shows a category budget's usage with no overall budget (TC-F8-22, BUG-029) |
| TG-10/11 / ZL-08/09 | each real receipt photo, then ❌ / `huy` | The photo reaches KIE (OCR + key-information extraction) through the real platform download, and the draft shows the receipt's **true total** |

The receipt steps take `--photo <file>` and expect that photo's true total. The photos are the five real MC-OCR receipts in `server/test/fixtures/receipts/` (114.700, 169.000, 45.000, 116.000, 124.000 ₫, the same as `kie.contract.test.js`). They need the KIE container and its Cloudflare tunnel up (`KIE_URL` on Vercel).

## Running it

```bash
node tools/bot-e2e/bot-e2e.mjs --help    # the usage (an unknown option prints the usage and exits 1)
node tools/bot-e2e/bot-e2e.mjs list      # the steps
node tools/bot-e2e/bot-e2e.mjs setup     # empties the e2e user (it must exist: see Target above)
node tools/bot-e2e/bot-e2e.mjs code      # code for TG-01 (run again for ZL-01: codes are single-use)
# after each step in the chat:
node tools/bot-e2e/bot-e2e.mjs step TG-02 --reply "<bot reply as shown>" --button "✅ Lưu" --button "❌ Huỷ" --button "✏️ Sửa"
node tools/bot-e2e/bot-e2e.mjs step TG-10 --photo mcocr_public_145014khrvg.jpg --reply "🧾 Đang đọc hoá đơn…" --reply "<draft reply>" --button …
node tools/bot-e2e/bot-e2e.mjs budget "Đi lại" 80000   # before ZL-14 only
node tools/bot-e2e/bot-e2e.mjs reset     # always at the end: no transactions, no budgets this month, no chat links
```

Run `step` right after its action: the state check is exact, and the next action changes it. A step that fails exits with code 1 and lists each problem (missing reply pattern, missing button, state difference). The tool's own self-test (TC-NF-15: help and bad options; TC-NF-20: no credentials file, no sign-up) is `node --test tools/bot-e2e/bot-e2e.test.mjs`; it needs no network.

### Driving the chats with Claude in Chrome

- **Read replies with a page script, not `find` or `get_page_text`.** Those two also return the other chats in the sidebar. These snippets read only the open conversation:
  - Telegram Web A: the `.MessageList .Message` elements. Swap emoji `<img alt>` for their alt text and drop `.MessageMeta`. The buttons are `button.Button` inside the message.
  - Zalo Web: the `[id^="message-frame_"]` elements, then `.text-message__container` inside each.
- **Photos:**
  1. Add a hidden `<input type=file>` to the page and fill it with the `file_upload` tool. The file must sit in a folder this session can read, such as the scratchpad.
  2. Dispatch a `paste` event carrying the file on the composer (`#editable-message-text` on Telegram, `#richInput` on Zalo).
  3. Press Send. This avoids the native file picker.
- **Buttons:** press them with real clicks. A script `click()` does not trigger Telegram's inline buttons. Take a fresh screenshot before clicking, because the Telegram photo dialog also has a spoiler toggle next to Send and the window can resize.
- **Zalo's bot chat starts with Zalo's bot-creation notice, which contains the bot token.** Never record a GIF or save a screenshot of that chat. Keep the evidence as text in `results.jsonl`.

## Runs

| Date | Target | Result | Notes |
|---|---|---|---|
| 2026-11-21 | production, student's own Telegram + Zalo | **36/36 pass** (TG-01…09, ZL-01…07, all 5 receipts on both chats + discard) | KIE read all 5 true totals on both platforms, the reply came in about 10–20 s. Same photo, different extras: through Zalo (which recompresses photos), 145014khrvg's merchant came out "MINIMART ANAN" instead of "HÓA ĐON BÁN HANG", and 145014cgzmv's line items no longer added up. The bot flags that ("cộng lại không khớp tổng tiền, hãy kiểm tra"), so it is a KIE accuracy note, not an app bug. Cleanup: 3 transactions deleted, 2 chats unlinked. |
| 2026-11-21 (round 2, before the T24–T29 fixes) | production (470ad5a), same chats | **33/34 pass** (TG-01…11 incl. receipts, ZL-01…09); RUN-017 | The one failure (TG-10, receipt 145014jcwux) was a tester ordering error: the 45.000 draft was shown, but its state was checked after ❌ Huỷ. Exploratory steps found **BUG-028** (Zalo: after a two-line message, a second `ok` said nothing was pending while the older draft still waited) and **BUG-029** (`/month` showed no line for category budgets). **BUG-033** (an over-cap line plus a good line: no reply, both lines lost) was reproduced in the Zalo chat on 5cc0b02, just before T29 was deployed (`round2/bot-chat-after-fixes/exploratory-zalo/14-15`). Evidence: `charter-runs/2026-11-21/round2/bot-chat/`. |
| 2026-11-22 | production (5cc0b02, then 0f62de3), after T24–T29 | **31/31 tool-checked pass**: TG-01…11 incl. all 5 receipts, ZL-01…07 and ZL-10…14; plus ZL-08/09 (5 receipts × read + discard) checked by hand; RUN-020 | ZL-08/09 ran after ZL-14, so the tool's exact state check would also have seen ZL-10…14's transactions; each receipt still made exactly one Zalo draft with its true total, and `huy` discarded it. Verified in the real chats: BUG-027 (`55k` corrects the waiting draft), BUG-028 (ZL-10…13: each `ok` reaches the next draft), BUG-029 (ZL-14: `/month` shows `Ngân sách "Đi lại": 80%`), BUG-033 after T29 (`xang 20000000000000` + `cafe 25k` → one 25.000 draft and "⚠️ Chưa ghi dòng 1 …" on Telegram and Zalo). Evidence: `charter-runs/2026-11-21/round2/bot-chat-after-fixes/`. |
