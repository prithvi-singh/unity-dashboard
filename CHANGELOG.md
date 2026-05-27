# Changelog

All notable changes to the Unity Clinical Ops Dashboard are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [1.1.0] - 2026-05-27

### Backend — New Routes

- `GET /api/metrics` — debug endpoint exposing the raw `metricsService` result; useful for verifying numbers match across tabs
- `GET /api/monitoring/top-performers` — top performers ranked by role-specific clinical output score (Clinician: assessments + reports + goals; Manager: approvals; Ops Admin: registrations + assignments); supports centre and date filters
- `GET /api/daily-review` — daily operational review data for the Daily Ops Review section
- `GET /api/centres` — per-centre operational overview with centre status classification (`blocked` / `needs-attention` / `ok`) based on stuck cases, completion rate, and staff activity
- `GET /api/issues` — all active assessments grouped by pipeline state with per-case severity levels (`watching` / `warning` / `critical`) and responsible-party attribution; point-in-time, no date filter
- `GET /api/workload` — per-centre workload metrics: active caseload (live snapshot), reports drafted, report edits, PDFs approved
- `GET /api/role` — role drill-down endpoint
- Refactored `GET /api/overview` to consume `metricsService` so overview numbers are guaranteed to match all other tabs
- Added `GET /api/bottlenecks/drill-down` for bottleneck detail expansion

### Backend — Infrastructure and Libraries

- **`services/metricsService.js`** — centralised single source of truth for all core dashboard metrics; runs all core queries in a single parallel batch; smart TTL cache (60 s for live periods, 30 min for historical periods) so two tabs with the same filters share one DB hit and see identical numbers
- **`lib/routeCache.js`** — lightweight in-memory route cache utility; `makeCache(ttlMs)` returns a per-route `get(key)` / `set(key, value)` pair
- **`lib/queryHelpers.js`** — shared SQL helper functions: `parseDateParam`, `buildDateFilter`, `buildCentreExclusion`, `buildPatientExclusion`; single place to update filter logic
- **`utils/assessmentState.js`** — single source of truth for the 7-state clinical pipeline classifier:
  - `NOT_STARTED` → `IN_PROGRESS` → `REPORT_NOT_DRAFTED` → `REPORT_PENDING_APPROVAL` → `GOALS_NOT_ADDED` → `GOALS_PENDING_APPROVAL` → `COMPLETED`
  - Three completion paths detected (direct status, `CaseStatusChanged` audit event, approved goal)
  - `TERMINAL_STATUSES`, `EXCLUDED_STATUSES`, `THRESHOLDS`, `STATE_LABELS`, `STATE_RESPONSIBLE` constants
  - Helper predicates: `isStuckAtScoring`, `isManagerBlocked`, `isClinicianBlocked`
  - SQL fragment helper: `terminalStatusExclusion(alias)`
- **`lib/clinicalPipelineQueries.js`** — shared pipeline query builder and row mapper used by both `metricsService` and `pipeline` route
- **`lib/formatters.js`** — shared formatting utilities including `abbreviateCentre` (applied consistently across all routes)
- **`lib/auditEventLabels.js`** — human-readable labels for all `PatientAuditLog.Type` values
- **`lib/pipelineDetailExprs.js`** — SQL column expressions for pipeline stage detail shared across queries
- **`utils/filters.js`** — unified filter constants and helpers
- **`utils/metrics.js`** — shared `FILTERS` object with `centreExclusion`, `patientExclusion`, `userExclusionStrict` helpers; used by every route and `metricsService`
- Self-ping warmup added to server startup: pings `/api/health` (or `SELF_PING_URL`) every 4 minutes to prevent Azure Container App idle scale-down
- Performance timing middleware logs all requests with latency; warns on requests >1 second
- Schema discovery now runs on dev startup only, not production

### Backend — Data Integrity and Bug Fixes

- **Assessment state classifier** fixes the "completed assessments showing as overdue" bug: `AllocatePatient.Status = 'Completed'` is checked first, before any audit-log-based logic, covering cases that pre-date the goal workflow and lack `AssessmentResultGenerated` events
- Verified all status values in `AllocatePatient.Status`: `NotStarted` (292), `InProgress` (211), `Completed` (54), `OnHold` (14) — no `Closed`, `Cancelled`, or `Inactive` values exist
- `ReportAdded`-only counting enforced across all routes (never `UpdateReport`) to prevent report-edit inflation
- `@mailinator.com` added to test-user exclusion filter in all routes
- `(Ops)` suffix in `FirstName`/`LastName` used to distinguish Ops Admins from Centre Managers in all queries
- Data discrepancy in active caseload queries resolved — now consistently uses non-terminal `AllocatePatient` rows (live snapshot, not date-filtered)
- Consistent `buildCentreExclusion` / `buildPatientExclusion` applied at SQL level across every route

### Frontend — New Tabs and Major Sections

- **Issues tab** (`/issues`) — complete redesign; assessments grouped by pipeline state with colour-coded severity chips; responsible-party badge (Clinician / Manager) on each group; expandable per-state tables with case name, assessment type, clinician, centre, and days waiting; compact header
- **Centres tab** (`/centres`) — per-centre status cards with `blocked` / `needs-attention` / `ok` classification; staff activity, completion rate, and stuck-case counts
- **Pipeline tab** — layout redesign; separate `PipelineFunnel` and `PipelineApprovalCards` components; manager approval performance cards
- **Daily Ops Review section** rebuilt as a dedicated view

### Frontend — Overview Tab Redesign

- New `PeriodSummary` component — headline numbers for the selected period
- New `YesterdayOutput` component — yesterday's clinical output at a glance
- New `EventTypeChart` component — audit event breakdown by type
- New `ActionFeed` component — chronological list of recent audit activity
- New `IdleCentresDrawer` component — slide-over listing idle centres with context
- New `MultipleAssessmentCasesPanel` component — cases with more than one concurrent active assessment
- `MetricCards` and `ActiveCentresPanel` updated to consume `metricsService`-backed data

### Frontend — Monitoring Tab Enhancements

- `DayPicker` component for selecting a specific day in the calendar view
- `ActivityHeatmap` — heatmap of user activity by day and hour
- `LivePulse` — live-updating pulse indicator
- `MonitoringEngagementFunnel` — funnel showing active → scoring → reporting engagement
- Top performers calendar view restored and fixed

### Frontend — Users Tab Enhancements

- `UserKpiCards` — KPI chips at the top of the Users tab
- `UserTrendChart` — user activity trend over the selected period
- `UserActionBreakdown` — per-action-type breakdown for a user
- `UserConsistencyHeatmap` — consistency heatmap for individual users
- `ActiveCaseloadTable` — live caseload table on the user profile page
- `RecentActionsTable` — recent audit actions on the user profile page
- `UserProfileLink` — inline link component that deep-links to a user profile page

### Frontend — Assessments Tab Enhancements

- `AssessmentTypeCards` — per-type KPI cards (SPM, DP3, REELS, ISAA)
- `AssessmentCompletionChart` — completion rate trend chart
- `AssessmentClinicianMatrix` — clinician × assessment-type output matrix
- `OverdueAssessmentsTable` — list of assessments past threshold, sorted by days overdue

### Frontend — Bottlenecks Tab Enhancements

- `BottleneckFunnel` — pipeline funnel visualisation showing where cases are accumulating
- `BottleneckByCentre` — per-centre bottleneck breakdown
- `BottleneckActionTable` — actionable table of assessments requiring immediate attention
- `BottleneckCards` — top-line bottleneck metric cards
- `BottleneckDrillDownPanel` — expandable detail panel for a bottleneck stage

### Frontend — Shared Components

- `DrillDownTable` and `DrillDownDetailLines` — reusable drill-down table with expandable detail rows
- `RoleDrillDownPanel` — reusable panel for role-specific metric drill-down
- `RoleCentreTable` and `RoleCentreChart` — shared role × centre breakdown table and chart
- `PersonActivityChart` — per-person activity trend chart used across Clinicians, Managers, and Users tabs
- `ScrollRegion` — scroll-container wrapper with consistent overflow behaviour
- `ExportExcelButton` — one-click XLSX export for any table in the dashboard
- `KpiTooltip` — standardised `ⓘ` tooltip component used on all KPI cards

### Frontend — Navigation and UX

- Clickable navigation for profile pages — any name in any table is now a link to that user's profile
- Tab navigation positioning and layout fixes
- Managers tab 500-error bug fixed (bad join on missing `roleDrillDown` route)
- Centre names abbreviated consistently everywhere using shared `abbreviateCentre` helper

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

[1.1.0]: https://github.com/momsbelief/unity-dashboard/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/momsbelief/unity-dashboard/releases/tag/v1.0.0
