# Unity Clinical Ops Dashboard

A secure, internal operations dashboard for the Mom's Belief clinical network. It surfaces real-time metrics from the Unity patient management system — case throughput, assessment completion, report PDF generation, manager approval queues, pipeline bottlenecks, issues by state, and team activity — giving clinical leads and ops managers a single view of how centres are performing without exposing the underlying Unity application or write-access credentials.

---

## Tabs

| Tab | What it shows |
|---|---|
| Overview | Period summary, KPI cards, event-type breakdown, action feed, active/idle centre drill-downs |
| Pipeline | 7-stage clinical workflow funnel, manager approval cards, stuck cases |
| Clinicians | Output breakdown chart, per-clinician detail table, workload by centre |
| Centre Managers | Manager action breakdown and approval rate per centre |
| Ops Admins | Activity breakdown for users with `(Ops)` designation |
| Assessments | KPI cards per type (SPM, DP3, REELS, ISAA), completion trend, clinician matrix, overdue table |
| Daily Monitoring | User status, activity heatmap, live pulse, top performers calendar, engagement funnel |
| Bottlenecks | Bottleneck funnel, per-centre breakdown, actionable stuck-assessment table, drill-down panels |
| Issues | Active assessments grouped by 7-state pipeline classification with severity levels and responsible-party attribution |
| Centres | Per-centre status cards (`blocked` / `needs-attention` / `ok`) with staff activity and caseload |
| Users | Roster, active/quiet counts, individual user profile with action breakdown, caseload, and heatmap |

---

## Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 14, TypeScript, Tailwind CSS |
| Backend | Node.js, Express |
| Database | Azure SQL (read-only connection to `UnityDb`) |
| Auth | HMAC SHA-256 signed session cookie |

## Deployment

| Target | Platform | Trigger |
|---|---|---|
| Frontend | Vercel (`unity-dashboard-six.vercel.app`) | Push to `main` (auto-deploy) |
| Backend | Azure Container Apps (`unity-dashboard-api`) | Push to `main` via GitHub Actions |
| Container registry | Azure Container Registry (`parivaremindersacr.azurecr.io`) | Built by CI |

> **Do not create Azure resources manually through the portal.** All infrastructure is provisioned by the GitHub Actions workflow. See `CHANGELOG.md` and `.cursor/rules/deployment.mdc` for details.

## Local Development

### Prerequisites

- Node.js 20+
- npm 9+

### 1. Backend

```bash
cd backend
cp .env.example .env        # fill in DB_* values
npm install
npm run dev                 # starts on http://localhost:3001
```

### 2. Frontend

```bash
cd frontend
cp .env.example .env.local  # fill in NEXT_PUBLIC_* values
npm install
npm run dev                 # starts on http://localhost:3000
```

Open [http://localhost:3000](http://localhost:3000) and log in with the password set in `DASHBOARD_PASSWORD`.

> Both services must run concurrently. The frontend proxies API calls to the backend via `NEXT_PUBLIC_API_URL`.

---

## Environment Variables

### Backend (`backend/.env`)

| Variable | Required | Description |
|---|---|---|
| `DB_SERVER` | ✅ | Azure SQL server hostname (e.g. `myserver.database.windows.net`) |
| `DB_NAME` | ✅ | Database name (e.g. `UnityDb`) |
| `DB_USER` | ✅ | Read-only SQL login username |
| `DB_PASSWORD` | ✅ | Password for the SQL login |
| `DB_PORT` | — | SQL port — defaults to `1433` |
| `PORT` | — | Express server port — defaults to `3001` |
| `ALLOWED_ORIGIN` | ✅ | Frontend origin allowed by CORS (e.g. `https://unity-dashboard-six.vercel.app`) |
| `SELF_PING_URL` | — | Full public URL of the backend used for the 4-minute self-ping warmup that prevents Azure Container App idle scale-down. Defaults to `http://localhost:{PORT}/api/health` |

### Frontend (`frontend/.env.local`)

| Variable | Required | Description |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | ✅ | Full URL of the backend API (e.g. `https://unity-dashboard-api.azurecontainerapps.io`) |
| `DASHBOARD_PASSWORD` | ✅ | Login password for the dashboard |
| `NEXT_PUBLIC_UNITY_PATIENT_URL` | — | Deep-link template for opening a patient in Unity — use `{patientId}` as the placeholder (e.g. `https://unity.momsbelief.com/patient/{patientId}`) |

> Never commit `.env` or `.env.local` to version control. Production secrets live in Azure Container App environment variables (backend) and Vercel project settings (frontend).

---

## API Reference

All endpoints are read-only `GET` requests. Every query applies the four standard exclusion filters (test patients, test users, Super Admin role, deleted centres).

| Endpoint | Description |
|---|---|
| `GET /api/health` | DB connection health check |
| `GET /api/metrics` | Raw `metricsService` output — use to verify numbers match across tabs |
| `GET /api/overview` | Period KPIs, centre breakdown, report PDF drill-down |
| `GET /api/clinicians` | Per-clinician output breakdown |
| `GET /api/managers` | Per-manager action breakdown and approval rates |
| `GET /api/centre-admins` | Ops admin activity breakdown |
| `GET /api/centres` | Per-centre status, staff activity, completion rate, stuck cases |
| `GET /api/pipeline` | 7-stage clinical workflow pipeline with stage metrics and stuck cases |
| `GET /api/workload` | Per-centre caseload, reports drafted, PDFs approved |
| `GET /api/issues` | Active assessments grouped by pipeline state with severity levels |
| `GET /api/assessments` | Per-assessment-type KPIs (SPM, DP3, REELS, ISAA) |
| `GET /api/monitoring` | Daily user activity, heatmap data |
| `GET /api/monitoring/top-performers` | Top performers ranked by role-specific output score |
| `GET /api/daily-review` | Daily operational review data |
| `GET /api/bottlenecks` | Turnaround times, pending approval queues, manager queue depth |
| `GET /api/role` | Role-level drill-down metrics |
| `GET /api/users` | Full user roster with active/quiet split |
| `GET /api/users/:id` | Individual user profile with full activity history |

**Common query parameters** (all optional): `centreId`, `dateFrom` (ISO date), `dateTo` (ISO date).
