# Changelog

All notable changes to the Unity Clinical Ops Dashboard are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [1.0.0] - 2026-05-26

### Infrastructure

- Provisioned Azure SQL read-only login (`dashboarduser`) on `UnityDb` — dashboard reads never touch write paths
- Deployed backend API to Azure Container Apps (`unity-dashboard-api`) in `unity-dashboard-rg` resource group, West US 2 region
- Deployed frontend to Vercel at `unity-dashboard-six.vercel.app` with root directory set to `frontend/`
- Created GitHub Actions CI/CD workflow (`.github/workflows/unity-dashboard-api-AutoDeployTrigger-*.yml`) for zero-touch backend deploy on push to `main`
- Configured OIDC federated authentication between GitHub Actions and Azure via the `unity-dashboard-github` app registration — no long-lived secrets in CI
- Container images pushed to Azure Container Registry at `parivaremindersacr.azurecr.io`

### Backend API — Node.js / Express / Azure SQL

- `GET /api/health` — health check endpoint returning DB connection status
- `GET /api/overview` — aggregated clinical metrics with per-centre activity breakdown
- `GET /api/overview/report-pdfs` — per-centre drill-down: every `ReportPDFGenerated` and `ReportAdded` event in the period, grouped into PDFs and drafts with case name, assessment type, clinician, and actor
- `GET /api/clinicians` — per-clinician output breakdown with case and assessment counts
- `GET /api/managers` — per-manager activity breakdown including approval actions
- `GET /api/monitoring` — daily user activity monitoring with heatmap-ready data
- `GET /api/bottlenecks` — turnaround times, pending approvals, and stuck cases
- `GET /api/assessments/overview` — per-assessment-type KPIs across SPM, DP3, REELS, and ISAA
- `GET /api/pipeline` — clinical workflow pipeline with stage-by-stage case counts
- `GET /api/users/breakdown` — full user roster with active/quiet split per role and per centre, including per-user activity counts and last-seen dates
- `GET /api/users/:id` — individual user profile with full activity history
- Logged all `PatientAuditLog.Type` values on startup for schema discovery during development

**Schema tables used:** `PatientAuditLog`, `AdminUser`, `AdminUserRole`, `AdminRole`, `AdminUserCentre`, `Centre`, `AllocatePatient`, `Patient`, `PatientGoalApprovalRequest`, `PatientGoalApprovalRequestGoal`

### Data Integrity Filters

Applied at SQL level across all routes — no application-layer filtering:

- Excluded test patients: `FirstName` or `LastName LIKE '%test%'`
- Excluded developer accounts: email domains `@webority.com` and `@mailinator.com`
- Excluded Super Admin role from all ops-facing metrics
- Excluded centres with `DELETE` in their name
- `ReportAdded` events used for "Reports Drafted" metric (not `UpdateReport`) to prevent inflation from repeated edits

### Frontend — Next.js 14 / TypeScript / Tailwind CSS

**Tab navigation:** Overview · Pipeline · Clinicians · Centre Managers · Ops Admins · Assessments · Daily Monitoring · Bottlenecks · Users

- **Overview tab:** KPI metric cards, centre breakdown table, activity charts; clickable drill-downs on "Report PDFs Created" and "Active Centres"
- **Pipeline tab:** Clinical workflow funnel, manager approval rates, stuck cases table
- **Clinicians tab:** Output breakdown chart, per-clinician detail table
- **Centre Managers tab:** Manager action breakdown per centre
- **Ops Admins tab:** Ops admin activity (placeholder pending users table name join)
- **Assessments tab:** Per-type KPIs, completion rates, overdue assessments
- **Daily Monitoring tab:** User status table, activity heatmap, live pulse
- **Bottlenecks tab:** Turnaround metrics, pending approval queues, manager queue depth
- **Users tab:** Roster with role and centre breakdown, active/quiet user counts, individual user profile drawer

**Global controls:**

- Auto-refresh every 60 seconds with countdown timer
- Manual refresh button
- Centre filter (global, affects all tabs)
- Date range filter (global, affects all tabs)

**Drill-down panels:**

- `ActiveCentresPanel` — slide-over listing active vs idle centres with Cases Added / Assessments Done / PDFs Approved stat chips; amber highlight on centres with assessments but no PDFs yet
- `ReportPdfsPanel` — slide-over with collapsible per-centre cards separating PDFs Created from Drafts Awaiting Manager Approval; shows case name, assessment type, clinician, and actor; draft count surfaced in header with "Manager action required" call-out
- `RosterUserDrawer` — user list drawer with search, copy emails, CSV export, sortable table; stacks over `UserProfileDrawer`
- `UserProfileDrawer` — individual user profile with full activity history

### Teams → Roster Section

- Filtered Super Admin role from all roster views
- Renamed raw role keys to plain English labels
- Defined **Active** (≥1 action in period) vs **Quiet** (0 actions in period, seen before)
- Active/quiet counts are clickable — opens a user list drawer for that role or centre
- User list drawer: search, copy emails, export CSV, sortable columns, quiet users greyed out, never-active users highlighted red
- Period label dynamically reflects the global date range filter
- Per-role and per-centre breakdowns replace bar charts with a plain table

### Login & Security

- Password-protected login page at `/login`
- HMAC SHA-256 signed session cookie (`dashboard_session`)
- Next.js middleware protecting all routes except `/login` and `/api/auth/*`
- Session expires after 8 hours
- Unity branding on login page

### UI/UX Decisions

- Centre names abbreviated: `Mom's Belief Learning Centre` → `MBLC`, `Mom's Belief` → `MB`
- Removed all vanity aggregate action counts
- Replaced misleading relative progress bars with plain stat chips (no implied scale or finish line)
- Removed status badges (Critical / Healthy / Low) — thresholds were undefined
- Report Edits shown as secondary grey column for transparency alongside primary draft count
- Mobile-responsive layout throughout
- `ⓘ` tooltip on every KPI card explaining what the metric measures

### Known Limitations

- **Ops admin / clinical manager split** — pending a `(Ops)` suffix convention in full names, not yet present in the audit log
- **Goal approval lag / assessment approval lag** — require approval timestamp events in the audit log; currently structural placeholders
- **True login monitoring** — requires a sessions table; audit log activity used as proxy
- **Zoho data integration** — pending API access from the Zoho team

---

[1.0.0]: https://github.com/momsbelief/unity-dashboard/releases/tag/v1.0.0
