# library-management-system-for-boarding-schools
library management system for boarding schools come to solve the problems of losting books in rwanda schools or overdue students

## Running

```bash
npm install
cp .env.example .env   # fill in MONGODB_URI and JWT_SECRET
npm start              # or: npm run dev
npm run test:smoke     # offline smoke tests, no database required
```

## Environment

`PORT`, `NODE_ENV`, `MONGODB_URI`, `JWT_SECRET`, `JWT_EXPIRES_IN`,
`DEFAULT_LIBRARIAN_PASSWORD`, `CLIENT_ORIGIN`, and the optional groups below.

## Overdue reminders (WhatsApp + email)

`/api/notifications` — all routes require a JWT.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/channels` | Which channels this deployment can use |
| GET | `/overdue?dueSoonDays=` | Who should be reminded, with book counts and fine balances |
| GET | `/export-whatsapp?ids=STU001,STU002` | One combined `wa.me` link for a group |
| GET | `/` | History of reminders sent |
| POST | `/overdue/:memberId/send` | `{ channel: whatsapp\|email\|both, recipientType: member\|guardian }` |
| POST | `/bulk` | Same, for a whole class: `{ channel, memberIds\|admissionNos, limit }` |

**WhatsApp needs no credentials.** It returns `wa.me` deep links with the message
already typed, which the librarian opens on their own phone. Set
`SMTP_HOST`/`SMTP_USER`/`SMTP_PASS`/`MAIL_FROM` to enable email; without them the
email channel reports `skipped` rather than failing. Every send is recorded in the
`notifications` collection.

Set `MONGODB_URI` before running.

## Library assistant (chat)

`POST /api/assistant/chat` with `{ message, admissionNo?, useAi? }`.
`GET /api/assistant/status` reports what it can do.

It answers from the database with no external calls: catalogue search, availability,
borrowing limits, loan periods, renewals, reservations, fine rules, categories,
contact details, and a member's current books and fines given an admission number.

Setting `ASSISTANT_LLM_URL` and `ASSISTANT_LLM_KEY` (and optionally
`ASSISTANT_LLM_MODEL`) turns on natural-language rephrasing. The model only rewrites
the answer text that was already assembled from the database; it is never given the
raw data and cannot invent facts.
