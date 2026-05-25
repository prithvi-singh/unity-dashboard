# Unity Data Guide

> **Who this is for:** Ops, centre managers, and leadership using the Unity Dashboard  
> **Last updated:** May 2026

This guide explains the **data behind the dashboard** — not the full Unity database. It covers the tables, events, and statuses that drive your KPIs, bottlenecks, and user profiles.

---

## The workflow in one picture

Every child case moves through the same pipeline. The dashboard tracks each step:

```
Centre Admin registers child
        ↓
Manager or centre admin assigns assessment to clinician
        ↓
Clinician completes assessment → result generated
        ↓
(Optional) Clinician submits goals → Manager approves
```

Each arrow is recorded as an **activity event** in the system. That is what the dashboard counts.

---

## 7 tables that matter

### 1. Centre — Therapy locations

Where children receive services. Used for centre filters and per-centre breakdowns.

| Field | What it means |
|-------|---------------|
| Centre Name | Name shown in the dashboard |
| Status | Whether the centre is active |
| Address / Pin Code | Location details |

*Test and deleted centres are excluded from dashboard metrics.*

---

### 2. Patient — Children

Each row is one child enrolled in the programme.

| Field | What it means |
|-------|---------------|
| Patient ID | Case number shown in Unity (e.g. on drill-down screens) |
| First / Last Name | Child's name |
| Centre | Which centre the child belongs to |
| Date of Birth / Age | Demographics |
| Status | Whether the case is active |
| Diagnosis | Clinical diagnosis (if recorded) |

> **Note:** The database uses the word "Patient" — in Unity and this dashboard, that means **child**.

---

### 3. AdminUser — Staff

Clinicians, centre admins, managers, and ops users who work in Unity.

| Field | What it means |
|-------|---------------|
| First / Last Name | Staff member's name |
| Email | Login email |
| Role | Clinician, Manager, or Centre Admin (see below) |
| Centre(s) | Which centre(s) they are linked to |
| Status | Active or inactive account |
| Last Login | When they last signed in |

---

### 4. AdminUserRole & AdminUserCentre — Who does what, where

These are linking tables (not shown directly in the dashboard, but they determine what you see):

| Link | Meaning |
|------|---------|
| User → Role | Whether someone is a Clinician, Manager, or Centre Admin |
| User → Centre | Which centre(s) their activity is attributed to |

---

### 5. AllocatePatient — Assessment assignments

When a manager or centre admin assigns an assessment to a clinician for a child, a row is created here. **This is the core "work item" clinicians carry.**

| Field | What it means |
|-------|---------------|
| Child | Which patient this assessment is for |
| Clinician | Who is responsible |
| Assessment | Type: **SPM**, **DP3**, **REELS**, or **ISAA** |
| Status | Where the assessment is in the workflow (see statuses below) |
| Assigned date | When the assessment was assigned |
| Result generated? | Whether scoring is complete |

One child can have **multiple assessments** (e.g. SPM + DP3). That is why "Assessments" on the overview can be higher than "Cases".

---

### 6. PatientAuditLog — Activity events (most important)

Every meaningful action in Unity is logged here. **The dashboard is built almost entirely on this table.**

| Field | What it means |
|-------|---------------|
| When | Date and time of the action |
| Type | What happened (see event types below) |
| Child | Which case it relates to |
| Staff member | Who performed the action |
| Description | Extra detail (e.g. "New child case registered") |
| Centre | Derived from the child's centre |

---

### 7. PatientGoalApprovalRequest — Goal approvals

When a clinician submits therapy goals for manager review, it creates a request here. Used on the **Bottlenecks** tab.

| Field | What it means |
|-------|---------------|
| Assessment | Which assessment assignment the goals belong to |
| Goal status | Pending, Approved, or Rejected |
| Submitted / Updated | When the request was made or decided |

---

## Activity events the dashboard counts

These are the **Type** values in the activity log. Each KPI maps to one or more of these:

| Event type | Plain English | Used for |
|------------|---------------|----------|
| **CaseRegistered** | A new child was onboarded | Total Cases, onboarding metrics |
| **CaseAssigned** | An assessment was assigned to a clinician (by a manager or centre admin) | Assessments, handoff rate, routing |
| **AssessmentResultGenerated** | Clinician completed scoring for an assessment | Clinical pipeline — scoring complete |
| **ReportPDFGenerated** | Report PDF was generated for an assessment | Clinical pipeline — report PDF created |
| **Report shared** | Manager shared the report with the family (`AllocatePatientReport`) | Clinical pipeline — manager step after PDF |
| **Goals added** | Clinician submitted goals for manager review (`PatientGoalApprovalRequestGoal`) | Clinical pipeline — goals added |
| **Goals approved** | Manager approved submitted goals | Clinical pipeline — goals approved, goal turnaround |
| **CaseTransfer** | Assessment moved to a different clinician | Transfers, flags & alerts |
| **CaseStatusChanged** | Assessment was reset or status changed | Resets, flags & alerts |
| **Login** | Staff signed in | Live monitoring / engagement |

---

## Assessment types

| Code | Full name | What it measures |
|------|-----------|------------------|
| **SPM** | Sensory Processing Measure | How a child processes sensory input |
| **DP3** | Developmental Profile 3 | Broad developmental skills across domains |
| **REELS** | Receptive-Expressive Emergent Language Scale | Language development |
| **ISAA** | Indian Scale for Assessment of Autism | Autism screening and assessment |

---

## Assessment statuses

Status on an assigned assessment (`AllocatePatient`):

| Status | Meaning |
|--------|---------|
| **NotStarted** | Assigned but clinician hasn't begun |
| **InProgress** | Clinician is actively working on it |
| **OnHold** | Paused — counts toward active caseload |
| *(Completed)* | Result has been generated — no longer in active caseload |

The dashboard treats **NotStarted + InProgress + OnHold** as the clinician's **active caseload**. A case with no result after 14 days is flagged as **stuck**.

---

## Goal approval statuses

| Status | Meaning |
|--------|---------|
| **Pending** | Waiting for manager review — blocks clinician progress |
| **Approved** | Manager signed off — goal is active |
| **Rejected** | Manager declined — clinician must revise |

---

## Staff roles

| Role | Primary responsibility in the workflow |
|------|----------------------------------------|
| **Centre Admin** | Registers new children, assigns assessments, routes cases to clinical team |
| **Manager** | Assigns assessments to clinicians, approves goals, handles transfers |
| **Clinician** | Completes assessments, generates results, submits goals |

---

## How dashboard tabs map to data

| Dashboard tab | Main data sources |
|---------------|-------------------|
| **Overview** | Activity log (cases, assessments, results) + Centre |
| **Bottlenecks** | Activity log (timings) + Goal approvals + Assessment statuses |
| **Clinicians / Managers / Centre Admins** | Staff records + Activity log + Assessment assignments |
| **Monitoring** | Activity log (today's actions) + Staff login events |
| **User profile** | All of the above, filtered to one person |

---

## What this guide does not cover

Unity stores much more data that is **not relevant to the ops dashboard**:

- Individual assessment answers and scoring tables (DP3, ISAA, REELS, SPM detail)
- Family Service Plan goals, interventions, and tools
- Parent/guardian accounts
- Content library (videos, games, downloadable files)
- CMS admin accounts
- Password, security, and system internals

Those exist for clinical and content workflows inside Unity itself. Technical teams can refer to `schema-dump.txt` for the complete database schema (103 tables).

---

## Quick glossary

| Term | Meaning |
|------|---------|
| Case | A child enrolled at a centre |
| Assessment | A specific evaluation assigned to a clinician (SPM, DP3, etc.) |
| Result | Completed scoring / generated report for an assessment |
| Caseload | Assessments currently assigned and not yet completed |
| Onboarding | Time from case registration to first assessment assignment |
| Handoff / Routing | Getting a registered case to a clinician |
| Bottleneck | A step where cases pile up (stuck onboarding, pending goals, etc.) |
