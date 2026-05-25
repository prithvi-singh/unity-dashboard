import type { KpiDefinition } from '@/components/shared/KpiTooltip';

export const KPI = {

  // ─── OVERVIEW ────────────────────────────────────────────────────────────────

  TOTAL_CASES: {
    title: 'Total Cases',
    description: 'New child cases registered in Unity this period. One case = one child onboarded.',
  },

  ASSESSMENTS_ADDED: {
    title: 'Assessments',
    description: 'Assessments assigned to clinicians. One child can have several (SPM, DP3, REELS, ISAA).',
  },

  AVG_ASSESSMENTS_PER_CASE: {
    title: 'Avg per Case',
    description: 'Assessments ÷ cases. Above 1.0 is normal — many children get multiple tools.',
  },

  MULTIPLE_ASSESSMENT_CASES: {
    title: 'Multi-Assessment Cases',
    description: 'Children with 2+ assessment types. Click to see each case.',
  },

  RESULTS_GENERATED: {
    title: 'Report PDFs Created',
    description:
      'Assessments where the report PDF was generated. Counts each assessment separately. Scoring complete is an earlier pipeline step.',
  },

  ACTIVE_CENTRES: {
    title: 'Active Centres',
    description: 'Centres with at least one case, assessment, or result this period.',
  },

  FLAGS_AND_ALERTS: {
    title: 'Flags & Alerts',
    description: 'Resets plus transfers. High counts usually mean rework or staffing issues.',
  },

  RESETS: {
    title: 'Resets',
    description: 'Assessment work was undone and restarted. Spikes often mean training gaps.',
  },

  TRANSFERS: {
    title: 'Transfers',
    description: 'Assessment moved to another clinician — rebalancing or unavailability.',
  },

  COMPLETION_RATE: {
    title: 'Completion Rate',
    description: 'Share of assigned assessments with a result. Low = pending or blocked work.',
  },

  // ─── BOTTLENECKS ─────────────────────────────────────────────────────────────

  ONBOARDING_TURNAROUND: {
    title: 'Onboarding Turnaround',
    description: 'Hours from registration to first assignment. Target: under 24h.',
  },

  GOAL_APPROVAL_TURNAROUND: {
    title: 'Goal Approval Turnaround',
    description: 'Hours from goal submission to manager approval. Delays block clinicians.',
  },

  ASSESSMENT_COMPLETION: {
    title: 'Assessment Completion',
    description: 'Assigned assessments with a result. Below 80% means significant backlog.',
  },

  STUCK_IN_ONBOARDING: {
    title: 'Stuck in Onboarding',
    description: 'Registered 48h+ ago, still unassigned. Each one needs manager or admin action.',
  },

  ACTION_ITEMS: {
    title: 'Action Items',
    description: 'Incomplete assessments, pending goals, and stuck onboarding combined. Zero is the goal.',
  },

  PENDING_GOAL_APPROVALS: {
    title: 'Pending Goal Approvals',
    description: 'Goals awaiting manager review. Clinicians can\'t proceed until approved.',
  },

  PENDING_ASSESSMENTS: {
    title: 'Pending Assessments',
    description: 'Assigned but no result yet. High counts = outstanding clinician work.',
  },

  // ─── CLINICIAN PROFILE ───────────────────────────────────────────────────────

  CLINICIAN_RESULTS: {
    title: 'Report PDFs Created',
    description: 'Assessments where this clinician generated the report PDF. Counts each assessment separately.',
  },

  CLINICIAN_ACTIVE_CASELOAD: {
    title: 'Active Caseload',
    description: 'Open cases assigned to this clinician. Heavy load raises delay risk.',
  },

  CLINICIAN_YIELD: {
    title: 'Yield',
    description: 'Results ÷ total workload. High = efficient; low = stuck or overloaded.',
  },

  CLINICIAN_AUDIT_ACTIONS: {
    title: 'Audit Actions',
    description: 'Recorded actions in the period. Rough measure of system engagement.',
  },

  CLINICIAN_ACTIVE_DAYS: {
    title: 'Active Days',
    description: 'Days with at least one action. Low count may mean absence or disengagement.',
  },

  CLINICIAN_AVG_TIME_TO_RESULT: {
    title: 'Avg Time to Result',
    description: 'Assignment to result. Shorter is better; long times suggest overload or complexity.',
  },

  CLINICIAN_STUCK_CASES: {
    title: 'Stuck Cases',
    description: 'Assigned 14+ days with no result. Clinical progress has stalled.',
  },

  CLINICIAN_IDLE: {
    title: 'Idle Clinicians',
    description: 'Clinicians with open caseload and no Unity activity today. Login is not used as a signal — only real audit actions count.',
  },

  CLINICIAN_ACTIVE_STAFF: {
    title: 'Active Staff',
    description: 'Clinicians who logged at least one case action in the selected period.',
  },

  CLINICIAN_CENTRE_QUEUE: {
    title: 'Workload by Centre',
    description: 'Caseload, results, and activity by centre. For delivery planning — not onboarding.',
  },

  CLINICAL_PIPELINE: {
    title: 'Clinical Pipeline',
    description: 'Per assessment, not per child. Tracks assign → score → report → share → goals → approve.',
  },

  // ─── MANAGER PROFILE ─────────────────────────────────────────────────────────

  MANAGER_CASES_REGISTERED: {
    title: 'Cases Registered',
    description: 'New cases this manager onboarded. Nothing starts without registration.',
  },

  MANAGER_ASSESSMENTS_ASSIGNED: {
    title: 'Assessments Assigned',
    description: 'Assessments handed to clinicians. Unassigned cases stall the pipeline.',
  },

  MANAGER_HANDOFF_RATE: {
    title: 'Handoff Rate',
    description: 'Registered cases that got at least one assignment. Below 100% = waiting children.',
  },

  MANAGER_TOTAL_ACTIONS: {
    title: 'Total Actions',
    description: 'Audit log actions this period. Engagement proxy.',
  },

  MANAGER_AVG_ONBOARDING: {
    title: 'Avg Onboarding Time',
    description: 'Registration to first assignment. Target: under 48h.',
  },

  MANAGER_STUCK_ONBOARDING: {
    title: 'Stuck Onboarding',
    description: 'Registered 48h+ ago, still unassigned. Needs immediate assignment.',
  },

  MANAGER_CENTRE_QUEUE: {
    title: 'Manager Queue',
    description: 'Registered vs assigned by centre. Unassigned = waiting for a clinician. Click to drill in.',
  },

  MANAGER_TRANSFERS: {
    title: 'Transfers',
    description: 'Assessments moved between clinicians. High volume may signal staffing gaps.',
  },

  MANAGER_STATUS_CHANGES: {
    title: 'Resets',
    description: 'Assessments reset — clinician work was undone. Often training or data-entry issues.',
  },

  // ─── CENTRE ADMIN PROFILE ────────────────────────────────────────────────────

  ADMIN_CASES_REGISTERED: {
    title: 'Cases Registered',
    description: 'Cases this admin registered. First step before any clinical work.',
  },

  ADMIN_ROUTED_TO_CLINICAL: {
    title: 'Routed to Clinical',
    description: 'Cases handed to the clinical team. Unrouted cases have no assessments yet.',
  },

  ADMIN_ROUTING_RATE: {
    title: 'Routing Rate',
    description: 'Registered cases that reached clinical. Below 100% = backlog in ops.',
  },

  ADMIN_TOTAL_ACTIONS: {
    title: 'Total Actions',
    description: 'Audit log actions this period.',
  },

  ADMIN_AVG_ROUTING_TIME: {
    title: 'Avg Routing Time',
    description: 'Registration to clinical assignment. Shorter = faster pipeline entry.',
  },

  ADMIN_SAME_DAY_ROUTING: {
    title: 'Same-Day Routing',
    description: 'Routed within 24h of registration.',
  },

  ADMIN_CENTRE_QUEUE: {
    title: 'Routing Queue',
    description: 'Registered vs routed by centre. Backlog = still in ops, not yet with a clinician.',
  },

  // ─── MONITORING ──────────────────────────────────────────────────────────────

  ENGAGEMENT_RATE: {
    title: 'Engagement Rate',
    description: 'Clinicians, managers, and centre admins who logged at least one case action today, out of all accounts in those roles. The subtitle also shows totals across every Unity login.',
  },

  ACTIONS_TODAY: {
    title: 'Actions Today',
    description: 'All audit actions today. Avg per active user shown below.',
  },

  CENTRES_ACTIVE: {
    title: 'Centres Active',
    description: 'Centres with at least one action today.',
  },

  NEED_FOLLOW_UP: {
    title: 'Idle Clinicians',
    description: 'Clinicians with open caseload and no Unity activity for 14+ days.',
  },

  MONITORING_ENGAGEMENT: {
    title: 'Who worked today?',
    description:
      'Every Unity login account (excluding test users and Super Admin). Breaks down by role so you can see who signed in, who did case work, and who needs a nudge. Click any number to filter the list below.',
  },

  // ─── USERS TAB ───────────────────────────────────────────────────────────────

  USER_TOTAL: {
    title: 'Total Users',
    description:
      'Staff accounts in scope for the current centre filter. Test users and @webority.com accounts are excluded. This is roster size, not daily logins.',
  },

  USER_ACTIVE_IN_PERIOD: {
    title: 'Active in Period',
    description:
      'Users with at least one audit-log action (case work, scoring, routing, etc.) in the selected date range.',
  },

  USER_QUIET_IN_PERIOD: {
    title: 'Quiet in Period',
    description:
      'In roster but no audit activity in the selected range. Different from a disabled Unity account — these users simply did not record any actions.',
  },

  USER_NEVER_ACTIVE: {
    title: 'Never Active',
    description:
      'Accounts with zero audit-log entries ever. Often new hires or unused logins — worth onboarding or access review.',
  },

  USER_ROLE_BREAKDOWN: {
    title: 'Role Breakdown',
    description:
      'Staff grouped by Unity role. Green = had audit activity in the selected period; grey = no activity in range. Bar width compares role size to the largest role.',
  },

  USER_CENTRE_BREAKDOWN: {
    title: 'Centre Breakdown',
    description:
      'Roster headcount per centre. Active = users with audit activity in the selected period. Clinicians vs others split is by role name.',
  },

  USER_RECENTLY_INACTIVE: {
    title: 'Recently Inactive',
    description:
      'Had audit history before, but nothing in the last 30 days. Independent of the date picker — always a rolling 30-day window.',
  },

  // ─── ASSESSMENT TYPES ────────────────────────────────────────────────────────

  ASSESSMENT_SPM: {
    title: 'SPM',
    description: 'Sensory Processing Measure — sensory patterns across environments. Usually 1–2 sessions.',
  },

  ASSESSMENT_DP3: {
    title: 'DP3',
    description: 'Developmental Profile 3 — multi-domain assessment. Longer to administer and score.',
  },

  ASSESSMENT_REELS: {
    title: 'REELS',
    description: 'Language scale for young children — receptive and expressive skills.',
  },

  ASSESSMENT_ISAA: {
    title: 'ISAA',
    description: 'Autism assessment calibrated for India. Often multi-session.',
  },

  // ─── CENTRE TABLE (OVERVIEW) ─────────────────────────────────────────────────

  CENTRE_CASES: {
    title: 'Centre Cases',
    description: 'Cases registered at this centre this period.',
  },

  CENTRE_ASSESSMENTS: {
    title: 'Centre Assessments',
    description: 'Assessments assigned at this centre. One case can have several.',
  },

  CENTRE_RESULTS: {
    title: 'Centre Results',
    description: 'Completed assessments with a result.',
  },

  CENTRE_COMPLETION: {
    title: 'Completion Rate',
    description: 'Cases with at least one result. Healthy centres sit above 75%.',
  },

} satisfies Record<string, KpiDefinition>;
