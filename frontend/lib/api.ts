import type {
  FilterParams,
  CoreMetrics,
  OverviewData,
  Clinician,
  Manager,
  CentreAdmin,
  MonitoringData,
  BottleneckData,
  UserProfileData,
  UserProfileParams,
  UserBreakdownData,
  UserSummaryProfile,
  AssessmentOverviewData,
  PipelineData,
  WorkloadCentreRow,
  ReportPdfCentre,
  TopPerformersResponse,
  DailyReviewData,
  CentresOverviewData,
  CentreDetailData,
  IssuesData,
} from './types';
import type {
  BottleneckDrillDownParams,
  BottleneckDrillDownResponse,
} from './bottleneckDrillDown';
import type {
  RoleDrillDownParams,
  RoleDrillDownResponse,
  RoleKind,
  RoleSummary,
  ClinicalPipelineData,
} from './roleDrillDown';

const BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

function buildQuery(params: FilterParams): string {
  const q = new URLSearchParams();
  if (params.centreId != null) q.set('centreId', String(params.centreId));
  if (params.dateFrom) q.set('dateFrom', params.dateFrom);
  if (params.dateTo) q.set('dateTo', params.dateTo);
  const str = q.toString();
  return str ? `?${str}` : '';
}

async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
  const url = `${BASE_URL}${path}`;
  const res = await fetch(url, { cache: 'no-store', signal });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((body as { error?: string }).error || `Request failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export function fetchMetrics(params: FilterParams = {}): Promise<CoreMetrics> {
  return get<CoreMetrics>(`/api/metrics${buildQuery(params)}`);
}

export function fetchOverview(params: FilterParams = {}, signal?: AbortSignal): Promise<OverviewData> {
  return get<OverviewData>(`/api/overview${buildQuery(params)}`, signal);
}

export function fetchReportPdfs(params: FilterParams = {}): Promise<ReportPdfCentre[]> {
  return get<ReportPdfCentre[]>(`/api/overview/report-pdfs${buildQuery(params)}`);
}

export function fetchClinicians(params: FilterParams = {}): Promise<Clinician[]> {
  return get<Clinician[]>(`/api/clinicians${buildQuery(params)}`);
}

export function fetchManagers(params: FilterParams = {}): Promise<Manager[]> {
  return get<Manager[]>(`/api/managers${buildQuery(params)}`);
}

export function fetchCentreAdmins(params: FilterParams = {}): Promise<CentreAdmin[]> {
  return get<CentreAdmin[]>(`/api/centre-admins${buildQuery(params)}`);
}

export function fetchMonitoring(date: string): Promise<MonitoringData> {
  return get<MonitoringData>(`/api/monitoring?date=${encodeURIComponent(date)}`);
}

export function fetchBottlenecks(params: FilterParams = {}): Promise<BottleneckData> {
  return get<BottleneckData>(`/api/bottlenecks${buildQuery(params)}`);
}

function buildProfileQuery(params: UserProfileParams): string {
  const q = new URLSearchParams();
  q.set('role', params.role);
  if (params.centreId != null) q.set('centreId', String(params.centreId));
  if (params.dateFrom) q.set('dateFrom', params.dateFrom);
  if (params.dateTo) q.set('dateTo', params.dateTo);
  return `?${q.toString()}`;
}

export function fetchUserProfile(userId: number, params: UserProfileParams): Promise<UserProfileData> {
  return get<UserProfileData>(`/api/users/${userId}/profile${buildProfileQuery(params)}`);
}

export function fetchUserBreakdown(params: FilterParams = {}): Promise<UserBreakdownData> {
  return get<UserBreakdownData>(`/api/users/breakdown${buildQuery(params)}`);
}

export function fetchUserSummaryProfile(userId: number): Promise<UserSummaryProfile> {
  return get<UserSummaryProfile>(`/api/users/${userId}`);
}

function buildDrillDownQuery(params: BottleneckDrillDownParams): string {
  const q = new URLSearchParams();
  q.set('type', params.type);
  if (params.centreId != null) q.set('centreId', String(params.centreId));
  if (params.drillCentreId != null) q.set('drillCentreId', String(params.drillCentreId));
  if (params.dateFrom) q.set('dateFrom', params.dateFrom);
  if (params.dateTo) q.set('dateTo', params.dateTo);
  if (params.weekStart) q.set('weekStart', params.weekStart);
  if (params.weekEnd) q.set('weekEnd', params.weekEnd);
  if (params.severity) q.set('severity', params.severity);
  return `?${q.toString()}`;
}

export function fetchBottleneckDrillDown(
  params: BottleneckDrillDownParams
): Promise<BottleneckDrillDownResponse> {
  return get<BottleneckDrillDownResponse>(`/api/bottlenecks/drill-down${buildDrillDownQuery(params)}`);
}

function buildRoleDrillDownQuery(params: RoleDrillDownParams): string {
  const q = new URLSearchParams();
  q.set('type', params.type);
  if (params.centreId != null) q.set('centreId', String(params.centreId));
  if (params.drillCentreId != null) q.set('drillCentreId', String(params.drillCentreId));
  if (params.drillUserId != null) q.set('drillUserId', String(params.drillUserId));
  if (params.dateFrom) q.set('dateFrom', params.dateFrom);
  if (params.dateTo) q.set('dateTo', params.dateTo);
  return `?${q.toString()}`;
}

export function fetchRoleDrillDown(params: RoleDrillDownParams): Promise<RoleDrillDownResponse> {
  return get<RoleDrillDownResponse>(`/api/role/drill-down${buildRoleDrillDownQuery(params)}`);
}

export function fetchAssessments(params: FilterParams = {}): Promise<AssessmentOverviewData> {
  return get<AssessmentOverviewData>(`/api/assessments/overview${buildQuery(params)}`);
}

export function fetchRoleSummary(role: RoleKind, params: FilterParams = {}): Promise<RoleSummary> {
  const q = new URLSearchParams();
  q.set('role', role);
  if (params.centreId != null) q.set('centreId', String(params.centreId));
  if (params.dateFrom) q.set('dateFrom', params.dateFrom);
  if (params.dateTo) q.set('dateTo', params.dateTo);
  const str = q.toString();
  return get<RoleSummary>(`/api/role/summary?${str}`);
}

export function fetchClinicalPipeline(params: FilterParams = {}): Promise<ClinicalPipelineData> {
  return get<ClinicalPipelineData>(`/api/role/clinical-pipeline${buildQuery(params)}`);
}

export function fetchPipeline(params: FilterParams = {}): Promise<PipelineData> {
  return get<PipelineData>(`/api/pipeline${buildQuery(params)}`);
}

export function fetchWorkload(params: FilterParams = {}): Promise<WorkloadCentreRow[]> {
  return get<WorkloadCentreRow[]>(`/api/workload${buildQuery(params)}`);
}

export function fetchCentresOverview(params: FilterParams = {}): Promise<CentresOverviewData> {
  return get<CentresOverviewData>(`/api/centres/overview${buildQuery(params)}`);
}

export function fetchCentreDetail(centreId: number, params: FilterParams = {}): Promise<CentreDetailData> {
  return get<CentreDetailData>(`/api/centres/${centreId}/detail${buildQuery(params)}`);
}

export function fetchDailyReview(date: string, centreId?: number): Promise<DailyReviewData> {
  const q = new URLSearchParams({ date });
  if (centreId != null) q.set('centreId', String(centreId));
  return get<DailyReviewData>(`/api/daily-review?${q.toString()}`);
}

export interface TopPerformersParams extends FilterParams {
  role?:  string;
  limit?: number;
}

export function fetchIssues(): Promise<IssuesData> {
  return get<IssuesData>('/api/issues');
}

export function fetchTopPerformers(params: TopPerformersParams = {}): Promise<TopPerformersResponse> {
  const q = new URLSearchParams();
  if (params.centreId != null) q.set('centreId', String(params.centreId));
  if (params.dateFrom)         q.set('dateFrom', params.dateFrom);
  if (params.dateTo)           q.set('dateTo',   params.dateTo);
  if (params.role)             q.set('role',     params.role);
  if (params.limit != null)    q.set('limit',    String(params.limit));
  const str = q.toString();
  return get<TopPerformersResponse>(`/api/monitoring/top-performers${str ? `?${str}` : ''}`);
}
