# Zoho Creator Integration — Architecture Spec

Unity Clinical Ops Dashboard · July 2026
Goal: pull Zoho Creator data (patients, invoices, appointments, receipts, cycles, leads) into Unity as a fully isolated module. A Zoho outage, schema change, or credential expiry must never touch the existing SQL-backed dashboard. On the frontend it looks native — same design system, no visible seam.

---

## 1. Guiding principle: hard isolation

The Zoho module is a plugin, not a feature woven through the codebase.

**Backend rules**

- Everything Zoho lives in `/backend/zoho/`. Nothing inside it imports from `/backend/utils/`, `/backend/services/`, or route files. Nothing outside it imports from it — except one line in `server.js` mounting the router.
- Zoho routes live under their own prefix: `/api/zoho/*`. Existing `/api/*` endpoints are untouched.
- Zoho has its own cache, its own error types, its own env vars. It never touches the SQL connection pool.
- If `ZOHO_CLIENT_ID` is missing, the module mounts a stub router that returns `503 { source: 'zoho', configured: false }` — the rest of the app boots and runs normally.

**Frontend rules**

- Zoho data hooks in `/frontend/lib/zoho/`, Zoho-specific components in `/frontend/components/zoho/`. They consume the shared design system (Tooltip, table standards, card styles, state colours) but no shared page imports a Zoho component in phase 1.
- Every Zoho section renders a graceful fallback ("Zoho data unavailable — retrying") on error. A Zoho failure degrades one tab, never the app.

---

## 2. OAuth setup (do this first — one-time, ~15 min)

Zoho access tokens expire in **1 hour**. A pasted access token will break the dashboard within the hour. You need the **self-client refresh-token flow**: a permanent refresh token that the backend exchanges for fresh access tokens automatically.

### Step-by-step

1. Go to the Zoho API Console: **https://api-console.zoho.com** (log in as `it_momsbelief`, or have IT do this — the account must have access to `app-master-module`).
2. **Add Client → Self Client → Create.** Note the **Client ID** and **Client Secret**.
3. In the Self Client screen, open the **Generate Code** tab:
   - Scope: `ZohoCreator.report.READ`
   - Time duration: 10 minutes
   - Description: `unity-dashboard`
   - Click **Create** and copy the generated **code** (valid only for the duration chosen).
4. Exchange the code for a refresh token (within 10 min):

```bash
curl -X POST "https://accounts.zoho.com/oauth/v2/token" \
  -d "grant_type=authorization_code" \
  -d "client_id=CLIENT_ID" \
  -d "client_secret=CLIENT_SECRET" \
  -d "code=PASTED_CODE"
```

The response contains `refresh_token` — **permanent, save it**. (It also contains an `access_token` you can use to smoke-test the report endpoints immediately.)

5. Store as Azure Container Apps secrets/env vars (same place as `DB_PASSWORD`):

```
ZOHO_CLIENT_ID
ZOHO_CLIENT_SECRET
ZOHO_REFRESH_TOKEN
ZOHO_ACCOUNTS_URL   = https://accounts.zoho.com
ZOHO_API_BASE       = https://www.zohoapis.com
```

**Data-centre caveat:** your endpoints are `zohoapis.com` (US DC). If IT's Zoho org is actually on the India DC, everything becomes `zohoapis.in` / `accounts.zoho.in` — token exchange fails with `invalid_client` if DCs are mismatched. Verify with the smoke test in step 4 before writing code.

**Never** commit these values or hardcode them. Same rule as the dashboard login.

### Runtime token management (`/backend/zoho/auth.js`)

- On demand, POST to `{ZOHO_ACCOUNTS_URL}/oauth/v2/token` with `grant_type=refresh_token` → access token valid ~1 hour.
- Cache the access token in memory with its expiry; refresh proactively at ~50 minutes.
- Single-flight: concurrent requests share one refresh promise (Zoho rate-limits token requests — roughly 10 refreshes per 10 min per client, so never refresh per-request).
- On refresh failure: log, serve stale cached data if available, surface `503 { source: 'zoho' }` otherwise.

---

## 3. Zoho API facts that shape the design

- **API version:** use **v2.1** everywhere (`/creator/v2.1/data/...`). The v2 base URL in the shared doc is a typo — all seven report endpoints are v2.1. v2 and v2.1 differ in pagination and response shape; don't mix.
- **Pagination:** `max_records` up to 1000 per call (default 200). Next page via the `record_cursor` **response header**, passed back as a `record_cursor` **request header**. Loop until absent.
- **Field selection:** `field_config=quick_view` (default) or `detail_view`; start with quick_view, it's lighter.
- **Filtering:** `criteria` query param exists but syntax is fiddly; for our volumes, fetch + cache + filter server-side is simpler and fewer API calls.
- **Rate limits:** Zoho Creator caps API calls per day per account (plan-dependent, low thousands). This forces the caching posture below — the dashboard must not call Zoho per user request.

### The seven reports

| Module      | Report link name           | Unity name  |
|-------------|----------------------------|-------------|
| Patients    | `All_Contacts`             | patients    |
| Invoices    | `All_Invoices`             | invoices    |
| Appointments| `All_Appointmenta_Report`  | appointments|
| Receipts    | `All_Receipts1_Report`     | receipts    |
| Cycles      | `All_Cycles`               | cycles      |
| Leads       | `All_Leads`                | leads       |
| CRM Leads   | `CRM_Lead_Report`          | crm-leads   |

(Note the misspelling `Appointmenta` — it's in the actual link name; keep it in config, map to a clean name internally.)

---

## 4. Backend structure

```
/backend/zoho/
  index.js          # exports router; stub router if not configured
  auth.js           # token cache + refresh (single-flight)
  client.js         # fetch wrapper: base URL, auth header, retry w/ backoff,
                    #   pagination loop (record_cursor), 401 → force refresh once
  config.js         # report registry: { key, linkName, ttl, mapper }
  cache.js          # module-local TTL cache w/ stale-while-revalidate
  mappers/          # one file per report: Zoho field names → clean camelCase
    patients.js  invoices.js  appointments.js  receipts.js
    cycles.js  leads.js  crmLeads.js
  routes.js         # GET /api/zoho/health
                    # GET /api/zoho/summary          (counts for all modules)
                    # GET /api/zoho/:module          (list, ?from&to&search)
                    # GET /api/zoho/:module/:id      (detail)
```

**Mount (only cross-boundary line in the codebase):**

```js
// server.js
app.use('/api/zoho', require('./zoho').router);
```

### Caching (dictated by Zoho's rate limits)

- Full-report fetch per module, cached with per-module TTL: leads/appointments 10 min; invoices/receipts 30 min; patients/cycles 1 h.
- **Stale-while-revalidate:** serve cached instantly, refresh in background — mirrors the existing dashboard pattern, no flicker.
- Background warm loop refreshes each module on its TTL, so user requests ~never hit Zoho directly. Seven modules at these TTLs ≈ 400–500 calls/day, comfortably inside limits.
- On Zoho error: keep serving last-good data with a `stale: true, asOf: <timestamp>` flag; frontend shows "as of HH:MM".

### Mappers

Zoho Creator field names are display-label-derived and change when someone renames a field in the builder. Mappers are the firewall: each maps raw Zoho records to a stable internal shape and drops unknown fields. A Zoho-side rename breaks one mapper file, not the frontend. Unknown/missing fields → log once, return `null`, never throw.

Apply Unity's data-integrity conventions inside mappers where they translate (e.g. exclude records with `test` in name fields) — but as Zoho-local logic, **not** by importing `filters.js`.

---

## 5. Frontend structure

**Phase 1 — new top-level tab** (working name: **Business**; nav: Overview · Live · Team · Issues · Business):

```
/frontend/app/business/page.tsx
/frontend/lib/zoho/
  api.ts            # typed fetchers for /api/zoho/*
  types.ts          # Patient, Invoice, Appointment, Receipt, Cycle, Lead
  useZoho.ts        # SWR-style hook: cached, stale-while-revalidate,
                    #   error → { unavailable: true }
/frontend/components/zoho/
  ZohoSummaryCards.tsx   # metric-card style (bg-secondary, no border)
  ZohoModuleTable.tsx    # standard table: 44px rows, sortable, search,
                         #   filter, export CSV, row → detail drawer
  ZohoDetailDrawer.tsx   # 640px drawer standard
  ZohoUnavailable.tsx    # inline fallback + "as of HH:MM" stale badge
```

Tab layout, top to bottom: summary cards (one per module: count in period + delta) → module sub-tabs (Leads | Appointments | Invoices | Receipts | Patients | Cycles) → each a standard table with detail drawer.

**All existing design rules apply** — state colours only, no donuts, no decorative icons, date filter inclusive both ends, Sunday highlighting in any calendar view. That's what makes it seamless: a user can't tell the data source changed.

**Phase 2 — blend (only after phase 1 is stable ~1–2 weeks):** surface 2–3 numbers (e.g. new leads today, appointments today) on Overview via the same `useZoho` hook, each wrapped so failure collapses the widget silently. Possible later: link Zoho patients ↔ Unity patients (needs a shared key — check whether Zoho `All_Contacts` stores Unity `PatientID`).

---

## 6. Failure modes → behaviour

| Failure | Behaviour |
|---|---|
| Zoho creds missing | Module mounts stub; app unaffected; Business tab shows setup notice |
| Refresh token revoked | `/api/zoho/*` → 503; serve stale if cached; alert in logs; rest of app fine |
| Zoho slow/down | Stale cache served with `asOf` badge; background retry w/ backoff |
| Field renamed in Zoho | One mapper logs + nulls that field; nothing crashes |
| Rate limit hit | Warm loop backs off; stale cache continues serving |
| Zoho returns garbage | Mapper validation drops bad records, logs count |

---

## 7. Build order

1. OAuth self-client setup + `curl` smoke test against `All_Leads` (proves creds, DC, and scope before any code)
2. `/backend/zoho/` — auth, client (pagination), config, cache, `health` + `summary` routes; deploy; verify `/api/zoho/health`
3. Mappers + module routes for all seven reports
4. Frontend Business tab: cards + tables + drawer
5. Warm loop + stale-while-revalidate polish, `asOf` badges
6. Verification: counts in summary cards must equal table row counts (same rule as active caseload); `npm run verify` extended with a Zoho consistency check
7. (Later) Phase 2 blending into Overview

### Cursor skill routing for this work

(Assumes `skill-routing.mdc` is in `.cursor/rules/` — supersedes the old @backend-architect convention.)

- Step 1 (OAuth setup): manual, no agent — it's clicks + one curl.
- Steps 2–4: `ce-plan` against this doc to break into executable chunks, then `ce-work` per chunk. Fall back to `@backend-architect` only if a design question opens up that this doc doesn't answer (e.g. volumes force incremental fetch — see §8 Q2).
- Before each PR: `ce-code-review`; ship via `ce-commit-push-pr`; watch with `ce-babysit-pr`.
- Step 5 (polish): `ce-polish` for the in-browser pass on the Business tab.
- Step 6 (verification): `ce-debug` if counts don't reconcile.
- After: `ce-compound` to capture the Zoho quirks (record_cursor pagination, `Appointmenta` typo, DC mismatch symptom, 1-hour token expiry) so they're never re-learned.

Give Cursor the folder contract from §4/§5, not field-level detail — let it discover Zoho response shapes from a live sample you paste in.

---

## 8. Open questions (answer before/while building)

1. **Data centre** — US (`zohoapis.com`) or India (`zohoapis.in`)? The smoke test settles it.
2. **Data volumes** — how many records per report? >5–10k rows in invoices changes caching from full-fetch to criteria-filtered incremental fetch.
3. **Linking key** — does Zoho `All_Contacts` carry Unity `PatientID`? Determines whether phase 2 can do patient-level cross-referencing or only aggregate numbers.
4. **Who owns the Zoho app** — if IT renames fields/reports, agree on a heads-up channel; mappers protect the code but not the meaning of the data.
