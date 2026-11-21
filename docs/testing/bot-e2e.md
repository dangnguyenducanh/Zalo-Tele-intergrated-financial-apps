# Real-chat bot e2e (Telegram + Zalo)

The webhook contract tests (`server/test/telegram.test.js`, `zalo.test.js`) and charters MT-02/MT-03 send **simulated** webhook payloads, so they never see a real chat app, a real bot reply, a real button press or a real photo download. This runbook closes that gap: someone types into the **real** Telegram and Zalo chats with the deployed bots, and [`tools/bot-e2e/bot-e2e.mjs`](../../tools/bot-e2e/bot-e2e.mjs) checks, after each step, that the expected bot replies and buttons are there (extra replies don't fail a step) and that the server state is exactly as expected, using the API. Test cases: TC-F7-08 (linking), TC-F8-16 (Telegram text), TC-F8-17 (Zalo text), TC-F8-18 (real receipts). They sit in the catalogue's feature groups, not under a separate TC-BOT-E2E prefix.

- **Driver:** Claude in Chrome on Telegram Web (`web.telegram.org/a/`) and Zalo Web (`chat.zalo.me`), logged in as the student's own accounts. A person on a phone works the same way.
- **Target:** production (both bots' webhooks point there), with a dedicated e2e web user `bot-e2e-…@example.com`. The checker creates it on first use and keeps its login in `~/.config/bot-e2e/<host>.json` (0600), never in the repo. Cleanup unlinks its chats and deletes its transactions through the API (a soft delete, like the web's delete: the rows stay in the database with `deletedAt`), so the chats are free to link elsewhere afterwards. `--target` defaults to production. Pass `--target staging` for anything else.
- **Steps:** [`tools/bot-e2e/scenarios.json`](../../tools/bot-e2e/scenarios.json). Each step has the action, the regexes the bot replies must match, the buttons (Telegram), and the exact state afterwards (`links`, `drafts`, `confirmed` as `source:amount` multisets).
- **Evidence:** `charter-runs/<VN date>/bot-e2e/results.jsonl`, one JSON line per checked step. This folder is git-ignored because it holds chat text.

| Step | Chat | Proves |
|---|---|---|
| TG-01 / ZL-01 | `/start CODE` · `/link CODE` | A link code links the real chat account (single-use code from `bot-e2e.mjs code`) |
| TG-02, TG-04 / ZL-02, ZL-04 | `phở 45k`, two lines `grab 32k` + `cafe 25k` / `grab 32k`, `cafe 25k` | Text → one draft per line, with ✅ Lưu / ❌ Huỷ / ✏️ Sửa (Telegram) or the "ok / huy" hint (Zalo) |
| TG-03, TG-05, TG-06 / ZL-03, ZL-05, ZL-06 | ✅ / ❌ buttons · `ok` / `huy` | Confirm and discard change the server; Zalo acts on the pending draft; `ok` with nothing pending is answered |
| TG-07 / ZL-07 | `/today` · `/month` | Totals count confirmed transactions only, across both chats |
| TG-08, TG-09 | `xin chào`, `/start ABC234` | No amount → help, nothing stored; a linked chat refuses a second code |
| TG-10/11 / ZL-08/09 | each real receipt photo, then ❌ / `huy` | The photo reaches KIE (OCR + key-information extraction) through the real platform download, and the draft shows the receipt's **true total** |

The receipt steps take `--photo <file>` and expect that photo's true total. The photos are the five real MC-OCR receipts in `server/test/fixtures/receipts/` (114.700, 169.000, 45.000, 116.000, 124.000 ₫, the same as `kie.contract.test.js`). They need the KIE container and its Cloudflare tunnel up (`KIE_URL` on Vercel).

## Running it

```bash
node tools/bot-e2e/bot-e2e.mjs list      # the steps
node tools/bot-e2e/bot-e2e.mjs setup     # e2e user exists and is empty
node tools/bot-e2e/bot-e2e.mjs code      # code for TG-01 (run again for ZL-01: codes are single-use)
# after each step in the chat:
node tools/bot-e2e/bot-e2e.mjs step TG-02 --reply "<bot reply as shown>" --button "✅ Lưu" --button "❌ Huỷ" --button "✏️ Sửa"
node tools/bot-e2e/bot-e2e.mjs step TG-10 --photo mcocr_public_145014khrvg.jpg --reply "🧾 Đang đọc hoá đơn…" --reply "<draft reply>" --button …
node tools/bot-e2e/bot-e2e.mjs reset     # always at the end: no transactions, no chat links
```

Run `step` right after its action: the state check is exact, and the next action changes it. A step that fails exits with code 1 and lists each problem (missing reply pattern, missing button, state difference).

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
