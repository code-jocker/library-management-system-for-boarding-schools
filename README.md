# Library Management System — Boarding School

A complete, production-ready **Library Management System** for a boarding school,
built as a **Single Page Application** (vanilla JS ES modules, no build step) backed
by a **Node.js / Express / MongoDB** REST API.

The only system user is the school librarian, **Umutoni Jeannette**. Students and
teachers are *member records* she manages — they never log in.

**Top priorities:** speed at the circulation desk (issue/return in under 15 seconds),
simplicity, reliability on slow internet and phones/tablets, and a professional
school-product look.

---

## 1. Feature overview

| Area | What it does |
|------|--------------|
| **Dashboard** | Stat cards, books-borrowed-per-month chart, books-by-category doughnut, most-borrowed list, "due today" and "overdue" quick lists with one-click Return. |
| **Books** | Table/card views, search, filters, add/edit modal with compressed cover upload, CSV/Excel import, unique ISBN, cannot delete a book with active loans. |
| **Categories** | CRUD with live book counts and colour chips. |
| **Members** | Students & teachers, filters by class/stream/dormitory/type/status, photo upload, CSV/Excel import, printable library card (QR + barcode). |
| **Issue Book** | Scan-first desk screen: admission number → book code → due date → Issue. Blocks with an exact reason (overdue, unpaid fines, limit reached, no copies) and offers "Reserve instead". |
| **Return Book** | Scan book/member → live fine calculation → Return, Renew (max 2), Mark Lost, Mark Damaged, reservation alert. |
| **Transactions** | Full history with date/status/class/member/book filters and CSV export. |
| **Overdue** | Days late, fine so far, guardian phone, single & bulk "print overdue notice to guardian". |
| **Fines** | Per-day automatic fines, partial/full payment, waive with reason, printable receipt with receipt number. |
| **Reservations** | FIFO queue on unavailable books, hold-on-return with expiry, fulfill or cancel. |
| **Reports** | Books issued, overdue, fines collected, most borrowed, unreturned by class, inventory, lost/damaged — each with Print, PDF and CSV. |
| **Clearance** | End-of-term: who still holds books/owes fines vs. who is cleared; single & bulk printable clearance certificates. |
| **Settings** | School details & logo, academic year/term, loan days, borrowing limits, fine per day, currency, classes/streams/dormitories, default language, and an activity-log viewer. |
| **Profile** | Librarian contact details, photo and change password. |

**Cross-cutting:** English + Kinyarwanda (instant switch), optional dark mode,
offline banner, keyboard shortcuts (`/` search, `Alt+I` issue, `Alt+R` return,
`Esc` close), 30-minute inactivity auto-logout, WCAG-AA-friendly responsive UI,
and letterhead printing for every document.

---

## 2. Tech stack

**Frontend** (loaded from `public/`, no bundler):
- HTML5 + Tailwind CSS (CDN, custom inline config) + a small `public/css/app.css`
- Vanilla JavaScript **native ES modules** (`<script type="module">`)
- Lucide icons, Google Fonts (Poppins / Inter), Chart.js
- PapaParse (CSV) + SheetJS (XLSX) for client-side import
- jsPDF + jspdf-autotable (PDF), qrcodejs + JsBarcode (library cards)
- All CDN libraries pinned to exact versions in `public/index.html`

**Backend:**
- Node.js + Express.js
- MongoDB (Atlas or local) with Mongoose
- JWT + bcryptjs (12 rounds) auth
- helmet (CSP), cors, compression, morgan, express-validator, express-rate-limit, dotenv

---

## 3. Folder structure

```
library-system/
├─ server.js                  # Express app: security, routes, static SPA, SPA fallback
├─ package.json
├─ .env.example               # copy to .env (never commit .env)
├─ .gitignore
├─ config/
│  └─ db.js                   # Mongoose connection
├─ models/                    # User, Book, Category, Member, Transaction,
│                             # Fine, Reservation, Setting, ActivityLog
├─ middleware/                # auth, validate, notFound, errorHandler, rateLimiter
├─ utils/                     # fineCalculator, activityLogger, csvHelpers,
│                             # receiptNumber, asyncHandler
├─ controllers/               # one per resource (auth, book, member, transaction, ...)
├─ routes/                    # Express routers mounted under /api
├─ seed/
│  ├─ seedLibrarian.js        # creates Umutoni Jeannette (mustChangePassword=true)
│  └─ sampleData.js           # 8 categories, 20 books, 15 students, sample loans
└─ public/                    # the SPA (served statically)
   ├─ index.html              # single document, pinned CDNs, tailwind.config
   ├─ css/app.css             # print styles, scrollbars, small tweaks
   ├─ images/favicon.svg
   └─ js/
      ├─ app.js               # bootstrap
      ├─ core/                # router, api, auth, store, i18n, utils, printer
      ├─ components/          # toast, modal, confirm, dataTable, forms, charts, ...
      ├─ locales/             # en.js, rw.js (parallel dictionaries)
      ├─ print/               # libraryCard, slip, receipt, certificate, overdueNotice, report
      └─ views/               # one module per route (lazy-loaded)
```

Every file listed above exists with complete, working code — there are no stubs,
TODOs, or placeholder functions.

---

## 4. Local setup (step by step)

### 4.1 Prerequisites
- **Node.js 18+** (Node 20/22 recommended)
- A **MongoDB** database — either:
  - **MongoDB Atlas** (free tier, recommended), or
  - a local MongoDB Community server.

### 4.2 Get a MongoDB connection string

**Atlas:**
1. Create a free cluster at https://cloud.mongodb.com.
2. *Database Access* → add a user (remember the password).
3. *Network Access* → allow your IP (or `0.0.0.0/0` for testing).
4. *Connect* → *Drivers* → copy the SRV string, e.g.
   `mongodb+srv://USER:PASSWORD@cluster0.xxxxx.mongodb.net/library-system?retryWrites=true&w=majority`

**Local:** `mongodb://127.0.0.1:27017/library-system`

### 4.3 Configure environment

```bash
cd library-system
cp .env.example .env
```

Edit `.env`:

```env
PORT=5000
NODE_ENV=development
MONGODB_URI=mongodb+srv://USER:PASSWORD@cluster0.xxxxx.mongodb.net/library-system
JWT_SECRET=put-a-long-random-secret-here
JWT_EXPIRES_IN=8h
DEFAULT_LIBRARIAN_PASSWORD=Librarian@2024
CLIENT_ORIGIN=http://localhost:5000
```

> `.env` is git-ignored. **Never commit it.**

### 4.4 Install, seed, run

```bash
npm install

# 1) create the librarian account (username: umutoni.jeannette)
npm run seed:librarian

# 2) optional: load demo data (categories, books, students, loans)
npm run seed:sample

# start the server
npm start            # or: npm run dev  (auto-reload with nodemon)
```

Open **http://localhost:5000**.

### 4.5 First login
- **Username:** `umutoni.jeannette`
- **Password:** the value of `DEFAULT_LIBRARIAN_PASSWORD` (default `Librarian@2024`)

She is forced to **change her password** on first login (`mustChangePassword=true`).

To clear demo data later: `npm run seed:sample:clear`.

---

## 5. Deployment

The app is a single Node service: Express serves both the `/api` and the static SPA,
so **one dyno/service** is enough. Images are stored as compressed base64 in MongoDB,
so an **ephemeral disk (Render/Railway free tier) works fine** — no file storage needed.

### 5.1 Render
1. Push the `library-system` folder to a Git repo.
2. Render → **New +** → **Web Service** → connect the repo.
   - **Root directory:** `library-system` (if it is not the repo root)
   - **Environment:** Node
   - **Build command:** `npm install`
   - **Start command:** `npm start`
3. Add environment variables (same keys as `.env`):
   `MONGODB_URI`, `JWT_SECRET`, `JWT_EXPIRES_IN`, `DEFAULT_LIBRARIAN_PASSWORD`,
   `NODE_ENV=production`, `PORT` (Render injects `PORT` automatically),
   `CLIENT_ORIGIN=https://<your-render-url>.onrender.com`.
4. After the first deploy, open the Render **Shell** (or add a one-off command) and run:
   `npm run seed:librarian` (and optionally `npm run seed:sample`).

### 5.2 Railway
1. Railway → **New Project** → **Deploy from GitHub repo**.
2. Set the **root directory** to `library-system` if needed.
3. Add the same environment variables as above; set
   `CLIENT_ORIGIN=https://<your-railway-domain>`.
4. Railway auto-detects Node and runs `npm start`.
5. Run the seed once via Railway's **Deploy** → shell / one-off:
   `npm run seed:librarian`.

### 5.3 Production notes
- Set `NODE_ENV=production` — stack traces are then hidden from API error responses.
- Use a **strong, unique** `JWT_SECRET`.
- In Atlas, add the host's IP (Render/Railway egress) to Network Access, or use `0.0.0.0/0`
  with a strong DB password.
- `CLIENT_ORIGIN` must match your public URL exactly (it gates CORS).

---

## 6. User guide — for Umutoni Jeannette

### Issue a book (target: under 15 seconds)
1. Click **Issue Book** (or press `Alt+I`). The admission-number box is already focused.
2. **Scan or type** the student's admission number, press **Enter** → the student card appears.
3. Focus jumps to the book box. **Scan or type** the ISBN/book code, press **Enter** → the book card appears.
4. The due date auto-fills from Settings (edit it if needed). Press **Enter** or click **Issue**.
5. A success toast appears; print the borrowing slip if wanted. The screen resets for the next student.

> If a red banner appears, it states the exact reason (overdue book, unpaid fine, limit
> reached, or no copies). With no copies you can click **Reserve instead**.

### Return a book
1. Click **Return Book** (or `Alt+R`).
2. Scan the book code (or the student's admission number) and press **Enter**.
3. Any fine is calculated automatically. Choose **Return**, **Renew** (max 2),
   **Mark Lost** or **Mark Damaged**. If someone reserved the book, an alert shows.

### Take a payment
**Fines** → row menu → **Pay** (full or partial, choose method) or **Waive** (with a reason).
Print the receipt from the same menu.

### Add students or books in bulk
**Members** or **Books** → **Import** → **Download template**, fill it in
(CSV or Excel), upload, review the preview with any row errors, then **Confirm import**.
You'll see a summary of created / skipped / failed rows.

### Print library cards / clearance
- **Members** → row menu → **Print library card** (single), or select a class for bulk.
- **Clearance** → filter by class/stream/dormitory → **Print clearance certificate**
  per cleared student, or **Print all certificates**.

### Change school settings
**Settings** — school name & logo, academic year/term, loan days, borrowing limits,
fine per day, currency, and the class/stream/dormitory lists. Changes apply everywhere
(printed documents, filters, rules) immediately. The **Activity log** tab records who
did what and when.

### Language & theme
Use the top-bar **language** switch (English / Ikinyarwanda) and the **dark-mode** toggle.
Both are remembered on this device.

---

## 7. API summary (all under `/api`, JWT required except login)

| Group | Endpoints |
|-------|-----------|
| `auth` | `POST /login`, `POST /change-password`, `GET /me`, `PUT /profile` |
| `books` | `GET /` (search/filter/paginate), `GET /lookup?code=`, `GET /meta/options`, `GET /:id`, `POST /`, `PUT /:id`, `DELETE /:id` |
| `categories` | `GET /`, `POST /`, `PUT /:id`, `DELETE /:id` |
| `members` | `GET /`, `GET /lookup?admissionNo=`, `GET /:id`, `GET /:id/card`, `POST /`, `PUT /:id`, `DELETE /:id` |
| `transactions` | `GET /`, `GET /overdue`, `POST /issue`, `POST /return`, `POST /renew`, `POST /mark-lost`, `POST /mark-damaged` |
| `fines` | `GET /`, `POST /pay`, `POST /waive`, `GET /:id/receipt` |
| `reservations` | `GET /`, `POST /`, `POST /:id/fulfill`, `POST /:id/cancel` |
| `reports` | `GET /books-issued`, `/overdue`, `/fines-collected`, `/most-borrowed`, `/unreturned-by-class`, `/inventory`, `/lost-damaged` |
| `settings` | `GET /`, `PUT /` |
| `dashboard` | `GET /` |
| `import` | `POST /books/preview`, `/books/commit`, `/members/preview`, `/members/commit` |
| `activity` | `GET /` |
| `clearance` | `GET /`, `GET /certificate/:memberId` |

Responses are `{ success, data, message }` on success and
`{ success:false, message, errors? }` on failure.

---

## 8. Business rules enforced

- **Atomic copies:** issuing uses a conditional `findOneAndUpdate({ availableCopies: { $gt: 0 } }, { $inc: { availableCopies: -1 } })`
  so two simultaneous requests can never over-issue the same copy.
- **Borrowing blocked** when a member is inactive, has overdue books, owes unpaid fines,
  or has reached the limit (default 3 students / 5 teachers, both configurable, and
  overridable per member).
- **Loans** default to 14 days (configurable). **Renew** max 2 times, blocked if overdue
  or if another member reserved the book.
- **Fines** accrue per day from due date to return date (configurable rate), shown live
  for unreturned books. Lost book = replacement value.
- **Reservations** are FIFO; a returned copy is held for the next member and expires
  after `reservationHoldDays`.
- A book with active loans cannot be deleted; ISBN and admission numbers are unique.

---

## 9. Security

- Passwords hashed with **bcrypt (12 rounds)**; JWT bearer auth on every API route.
- **helmet** with a CSP that allows only the pinned CDNs the SPA uses.
- **CORS** restricted to `CLIENT_ORIGIN`.
- **express-validator** on all write endpoints; normalized field errors.
- **Rate limiting:** login 5 / 15 min, general API 300 / min.
- All user data rendered in the SPA passes through `escapeHtml` / `textContent` (XSS-safe).
- Secrets live only in `.env` (git-ignored); no stack traces in production responses.
- Uploads are compressed client-side and size-capped server-side (413 if too large).

---

## 10. Troubleshooting

| Symptom | Fix |
|---------|-----|
| `MongoDB connection error` on start | Check `MONGODB_URI`; for Atlas, confirm your IP is allowed under Network Access and the DB user/password are correct. |
| Page loads but every call returns **401** | Your session expired or `JWT_SECRET` changed. Log in again; keep `JWT_SECRET` stable between restarts. |
| Login says **Invalid username or password** | Re-run `npm run seed:librarian`. Default user is `umutoni.jeannette`. |
| Stuck on **Change password** screen | Expected on first login — set a new password to continue. |
| **CORS** error in the browser console | Set `CLIENT_ORIGIN` to your exact public URL (scheme + host, no trailing slash). |
| Blank page / module errors | You must serve via `npm start` (http://localhost:5000), **not** by opening `index.html` directly — ES modules need http(s). |
| Images/covers look huge or fail to save | Uploads are auto-compressed; if a save returns **413**, use a smaller image. |
| PDF/CSV buttons do nothing | Those libs load from CDNs; check the browser console/network and that the CSP hosts are reachable. |
| Demo data keeps coming back | It is seeded once; clear with `npm run seed:sample:clear`. |
| Port already in use | Change `PORT` in `.env`. |

---

## 11. Default credentials (change immediately)

- **Username:** `umutoni.jeannette`
- **Password:** value of `DEFAULT_LIBRARIAN_PASSWORD` (default `Librarian@2024`)
- She is required to change it on first login.

---

Built as one continuous deliverable: complete code for every file, consistent API
paths / field names / translation keys across frontend and backend, and a running
file checklist with no missing pieces.
