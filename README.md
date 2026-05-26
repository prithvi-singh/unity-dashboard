# Unity Clinical Ops Dashboard

A secure, internal operations dashboard for the Mom's Belief clinical network. It surfaces real-time metrics from the Unity patient management system — case throughput, assessment completion, report PDF generation, manager approval queues, bottlenecks, and team activity — giving clinical leads and ops managers a single view of how centres are performing without exposing the underlying Unity application or write-access credentials.

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

### Frontend (`frontend/.env.local`)

| Variable | Required | Description |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | ✅ | Full URL of the backend API (e.g. `https://unity-dashboard-api.azurecontainerapps.io`) |
| `DASHBOARD_PASSWORD` | ✅ | Login password for the dashboard |
| `NEXT_PUBLIC_UNITY_PATIENT_URL` | — | Deep-link template for opening a patient in Unity — use `{patientId}` as the placeholder (e.g. `https://unity.momsbelief.com/patient/{patientId}`) |

> Never commit `.env` or `.env.local` to version control. Production secrets live in Azure Container App environment variables (backend) and Vercel project settings (frontend).
