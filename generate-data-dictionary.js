/**
 * Generates a non-technical data dictionary from schema-dump.txt
 */
const fs = require("fs");
const path = require("path");

const INPUT = path.join(__dirname, "schema-dump.txt");
const OUTPUT = path.join(__dirname, "DATA-DICTIONARY.md");

const SKIP_TABLES = new Set(["database_firewall_rules"]);

const TABLE_CATEGORIES = [
  {
    id: "overview",
    title: "How to read this guide",
    tables: [],
  },
  {
    id: "locations",
    title: "Centres & locations",
    description: "Where therapy centres are located and how they are organised geographically.",
    tables: ["Centre", "MasterState", "MasterCity"],
  },
  {
    id: "staff",
    title: "Staff & clinicians (Unity app users)",
    description: "People who work inside Unity — clinicians, centre admins, managers, and ops staff.",
    tables: [
      "AdminUser",
      "AdminRole",
      "AdminUserRole",
      "AdminUserCentre",
      "AdminUserAudit",
      "AdminUserPasswordHistory",
      "AdminUserTrustedDevice",
    ],
  },
  {
    id: "cms-users",
    title: "CMS administrators",
    description: "Separate admin accounts used to manage content (videos, games, files) in the CMS portal.",
    tables: [
      "CMSAdminUser",
      "CMSAdminRole",
      "CMSAdminUserRole",
      "CMSAdminUserAudit",
      "CMSAdminUserPasswordHistory",
      "CMSAdminUserTrustedDevice",
    ],
  },
  {
    id: "patients",
    title: "Children & families",
    description: "Core child (patient) records, parents/guardians, and general case information.",
    tables: [
      "Patient",
      "PatientParent",
      "PatientParentRole",
      "PatientParentUserRole",
      "PatientParentUserAudit",
      "PatientParentUserPasswordHistory",
      "PatientParentUserTrustedDevice",
      "PatientCaseHistory",
      "PatientCaseNote",
      "PatientCaseFile",
      "PatientAuditLog",
    ],
  },
  {
    id: "allocation",
    title: "Assessment assignments & workflow",
    description: "When a child is assigned an assessment to a clinician, and the reports produced from it.",
    tables: [
      "AllocatePatient",
      "AssessmentAllocationHistory",
      "AllocatePatientReport",
      "AllocatePatientIfspReport",
      "AllocatePatientISSAAssessmentGuideline",
      "PatientAssessmentFile",
      "PatientAssessmentNote",
      "FnpRecommendation",
    ],
  },
  {
    id: "dp3",
    title: "DP-3 assessment",
    description: "Developmental Profile 3 — a structured developmental assessment with questions, answers, and scoring.",
    tables: [
      "PatientDP3Assessment",
      "PatientDP3AssessmentItem",
      "PatientDP3AssessmentDevelopmentalProblemStatement",
      "PatientDP3AssessmentReport",
      "MasterPatientDP3AssessmentQuestion",
      "MasterPatientDP3AssessmentQuestionProblemStatement",
      "MasterPatientDP3AssessmentDevelopmentalProblemStatement",
      "MasterPatientDP3AssessmentRawScore",
      "MasterPatientDP3AssessmentStandardScore",
      "MasterPatientDP3AssessmentPercentileRank",
      "MasterPatientDP3AssessmentConfidenceInterval",
      "MasterPatientDP3AssessmentDescriptiveCategory",
      "MasterPatientDP3AssessmentGeneralDevelopmentScore",
    ],
  },
  {
    id: "isaa",
    title: "ISAA assessment",
    description: "Indian Scale for Assessment of Autism — assessment questions, answers, and FNP goals.",
    tables: [
      "PatientISAAAssessment",
      "PatientISAAAssessmentItem",
      "PatientISAAssessmentFnpGoal",
      "PatientISAAssessmentFnpGoalProgress",
      "MasterPatientISAAAssessmentQuestion",
      "MasterPatientISAAssessmentFnpGoal",
    ],
  },
  {
    id: "reels",
    title: "REELS assessment",
    description: "Receptive-Expressive Emergent Language Scale — language assessment by age group.",
    tables: [
      "PatientReelsAssessment",
      "PatientReelsAssessmentItem",
      "PatientReelsAssessmentAgeGroup",
      "PatientReelsAssessmentFnpBaseline",
      "PatientReelsAssessmentFnpGoal",
      "PatientReelsAssessmentFnpGoalProgress",
      "MasterPatientReelsAssessmentQuestion",
      "MasterPatientReelsAssessmentAgeRange",
      "MasterPatientReelsAssessmentFnpGoal",
    ],
  },
  {
    id: "spm",
    title: "SPM assessment",
    description: "Sensory Processing Measure — sensory profile assessment with goals and progress tracking.",
    tables: [
      "PatientSPMAssessment",
      "PatientSPMAssessmentItem",
      "PatientSPMAssessmentAgeGroup",
      "PatientSPMAssessmentFNPBaseline",
      "PatientSPMAssessmentFNPGoal",
      "PatientSPMAssessmentFNPGoalPlanAcitivity",
      "PatientSPMAssessmentFNPGoalProgress",
      "MasterPatientSPMAssessmentQuestion",
      "MasterPatientSPMAssessmentScore",
      "MasterPatientSPMAssessmentFNPBaseline",
    ],
  },
  {
    id: "fsp",
    title: "Family Service Plan (FSP)",
    description: "Therapy goals, objectives, interventions, and tools — both broader and developmental tracks.",
    tables: [
      "PatientBroaderProblemStatement",
      "PatientFspBroaderGoal",
      "PatientFspBroaderObjective",
      "PatientFspBroaderIntervention",
      "PatientFspBroaderTool",
      "PatientFspDevelopmentalGoal",
      "PatientFspDevelopmentalObjective",
      "PatientFspDevelopmentalIntervention",
      "PatientFspDevelopmentalTool",
      "MasterPatientBroaderProblemStatement",
      "MasterPatientFspBroaderGoal",
      "MasterPatientFspBroaderGoalSkillTag",
      "MasterPatientFspBroaderObjective",
      "MasterPatientFspBroaderIntervention",
      "MasterPatientFspDevelopmentalGoal",
      "MasterPatientFspDevelopmentalGoalSkillTag",
      "MasterPatientFspDevelopmentalObjective",
      "MasterPatientFspDevelopmentalIntervention",
      "MasterPatientFspToolSkillTag",
    ],
  },
  {
    id: "goals",
    title: "Goal approval requests",
    description: "When therapy goals need manager approval before becoming active.",
    tables: ["PatientGoalApprovalRequest", "PatientGoalApprovalRequestGoal"],
  },
  {
    id: "content",
    title: "Content library (videos, games, files)",
    description: "Educational and therapeutic content published to centres or parents.",
    tables: [
      "Video",
      "VideoMasterTag",
      "Game",
      "GameMasterTag",
      "CMSFile",
      "CMSFileMasterTag",
      "MasterTag",
    ],
  },
  {
    id: "reference",
    title: "Reference & lookup data",
    description: "Pre-defined templates and recommendations used across assessments.",
    tables: ["MasterFnpRecommendation"],
  },
];

const TABLE_DESCRIPTIONS = {
  Centre: "A therapy centre (clinic/location) where children receive services.",
  MasterState: "List of states used for centre addresses.",
  MasterCity: "List of cities within each state.",
  AdminUser: "A staff member who logs into Unity (clinician, centre admin, manager, etc.).",
  AdminRole: "A job role type for staff (e.g. Clinician, Centre Admin).",
  AdminUserRole: "Links a staff member to their role(s).",
  AdminUserCentre: "Links a staff member to the centre(s) they work at.",
  AdminUserAudit: "Login and activity history for staff accounts.",
  AdminUserPasswordHistory: "Previous passwords for staff accounts (for security policy).",
  AdminUserTrustedDevice: "Devices marked as trusted for a staff member's login.",
  CMSAdminUser: "An administrator who manages content in the CMS portal.",
  CMSAdminRole: "A role type for CMS administrators.",
  CMSAdminUserRole: "Links a CMS admin to their role.",
  CMSAdminUserAudit: "Login history for CMS admin accounts.",
  CMSAdminUserPasswordHistory: "Previous passwords for CMS admin accounts.",
  CMSAdminUserTrustedDevice: "Trusted devices for CMS admin logins.",
  Patient: "A child enrolled in the programme — the central record for each case.",
  PatientParent: "A parent or guardian linked to a child, including their login account.",
  PatientParentRole: "Role types available for parent accounts.",
  PatientParentUserRole: "Links a parent account to their role.",
  PatientParentUserAudit: "Login history for parent accounts.",
  PatientParentUserPasswordHistory: "Previous passwords for parent accounts.",
  PatientParentUserTrustedDevice: "Trusted devices for parent logins.",
  PatientCaseHistory: "Structured sections of a child's case history (background information).",
  PatientCaseNote: "Free-text notes added to a child's case by staff.",
  PatientCaseFile: "Documents uploaded to a child's general case file.",
  PatientAuditLog: "Activity log for actions taken on a child's record.",
  AllocatePatient: "An assessment assignment — links a child to a clinician for a specific assessment type.",
  AssessmentAllocationHistory: "History of changes when assessments are reassigned between staff.",
  AllocatePatientReport: "Generated assessment report (PDF) for an assignment.",
  AllocatePatientIfspReport: "Generated IFSP (Individualized Family Service Plan) report.",
  AllocatePatientISSAAssessmentGuideline: "Clinical guidelines attached to an ISAA assessment assignment.",
  PatientAssessmentFile: "Files uploaded during an assessment (e.g. supporting documents).",
  PatientAssessmentNote: "Notes written during an assessment.",
  FnpRecommendation: "Family Naturalistic Programming recommendations selected for an assessment.",
  PatientDP3Assessment: "A DP-3 assessment session for a child (grouped by developmental domain).",
  PatientDP3AssessmentItem: "A single question answer within a DP-3 assessment.",
  PatientDP3AssessmentDevelopmentalProblemStatement:
    "Problem statements identified from DP-3 answers.",
  PatientDP3AssessmentReport: "Generated DP-3 assessment report data.",
  MasterPatientDP3AssessmentQuestion: "Standard DP-3 question bank.",
  MasterPatientDP3AssessmentQuestionProblemStatement:
    "Maps DP-3 questions to problem statements and goals.",
  MasterPatientDP3AssessmentDevelopmentalProblemStatement:
    "Standard developmental problem statement templates.",
  MasterPatientDP3AssessmentRawScore: "Lookup table to convert raw scores to domain labels.",
  MasterPatientDP3AssessmentStandardScore: "Lookup table for standard scores by age and domain.",
  MasterPatientDP3AssessmentPercentileRank: "Converts standard scores to percentile ranks.",
  MasterPatientDP3AssessmentConfidenceInterval: "Confidence intervals by age for DP-3 domains.",
  MasterPatientDP3AssessmentDescriptiveCategory: "Score ranges mapped to descriptive labels (e.g. 'Average').",
  MasterPatientDP3AssessmentGeneralDevelopmentScore: "Overall developmental score calculation rules.",
  PatientISAAAssessment: "An ISAA assessment session for a child.",
  PatientISAAAssessmentItem: "A single question answer within an ISAA assessment.",
  PatientISAAssessmentFnpGoal: "FNP goals created from ISAA results for a child.",
  PatientISAAssessmentFnpGoalProgress: "Progress updates on an ISAA FNP goal.",
  MasterPatientISAAAssessmentQuestion: "Standard ISAA question bank.",
  MasterPatientISAAssessmentFnpGoal: "Standard FNP goal templates for ISAA.",
  PatientReelsAssessment: "A REELS language assessment session for a child.",
  PatientReelsAssessmentItem: "A single question answer within a REELS assessment.",
  PatientReelsAssessmentAgeGroup: "Age group classification for a REELS assessment.",
  PatientReelsAssessmentFnpBaseline: "Baseline skill levels from REELS for FNP planning.",
  PatientReelsAssessmentFnpGoal: "FNP goals created from REELS results.",
  PatientReelsAssessmentFnpGoalProgress: "Progress updates on a REELS FNP goal.",
  MasterPatientReelsAssessmentQuestion: "Standard REELS question bank.",
  MasterPatientReelsAssessmentAgeRange: "Age ranges used to group REELS questions.",
  MasterPatientReelsAssessmentFnpGoal: "Standard FNP goal templates for REELS.",
  PatientSPMAssessment: "An SPM sensory assessment session for a child.",
  PatientSPMAssessmentItem: "A single question answer within an SPM assessment.",
  PatientSPMAssessmentAgeGroup: "Age group used for SPM scoring.",
  PatientSPMAssessmentFNPBaseline: "Baseline sensory profile for FNP planning.",
  PatientSPMAssessmentFNPGoal: "FNP goals created from SPM results.",
  PatientSPMAssessmentFNPGoalPlanAcitivity: "Planned activities linked to an SPM FNP goal.",
  PatientSPMAssessmentFNPGoalProgress: "Progress updates on an SPM FNP goal.",
  MasterPatientSPMAssessmentQuestion: "Standard SPM question bank.",
  MasterPatientSPMAssessmentScore: "Scoring lookup table for SPM (T-scores by age).",
  MasterPatientSPMAssessmentFNPBaseline: "Standard baseline templates for SPM FNP.",
  PatientBroaderProblemStatement: "Broad problem areas identified for a child's FSP.",
  PatientFspBroaderGoal: "A broader-track therapy goal for a child.",
  PatientFspBroaderObjective: "A measurable objective under a broader problem statement.",
  PatientFspBroaderIntervention: "An intervention strategy for a broader objective.",
  PatientFspBroaderTool: "A recommended tool/resource linked to a broader goal.",
  PatientFspDevelopmentalGoal: "A developmental-track therapy goal for a child.",
  PatientFspDevelopmentalObjective: "A measurable objective under a developmental problem statement.",
  PatientFspDevelopmentalIntervention: "An intervention strategy for a developmental objective.",
  PatientFspDevelopmentalTool: "A recommended tool/resource linked to a developmental goal.",
  MasterPatientBroaderProblemStatement: "Standard broader problem statement templates.",
  MasterPatientFspBroaderGoal: "Standard broader goal templates.",
  MasterPatientFspBroaderGoalSkillTag: "Skill tags associated with broader goals.",
  MasterPatientFspBroaderObjective: "Standard broader objective templates.",
  MasterPatientFspBroaderIntervention: "Standard broader intervention templates.",
  MasterPatientFspDevelopmentalGoal: "Standard developmental goal templates.",
  MasterPatientFspDevelopmentalGoalSkillTag: "Skill tags associated with developmental goals.",
  MasterPatientFspDevelopmentalObjective: "Standard developmental objective templates.",
  MasterPatientFspDevelopmentalIntervention: "Standard developmental intervention templates.",
  MasterPatientFspToolSkillTag: "Catalogue of therapy tools/resources with skill mappings.",
  PatientGoalApprovalRequest: "A request to approve therapy goals for a child.",
  PatientGoalApprovalRequestGoal: "Individual goals included in an approval request.",
  Video: "A video resource in the content library.",
  VideoMasterTag: "Tags applied to a video for filtering/search.",
  Game: "An interactive game/activity in the content library.",
  GameMasterTag: "Tags applied to a game.",
  CMSFile: "A downloadable file in the content library.",
  CMSFileMasterTag: "Tags applied to a CMS file.",
  MasterTag: "Shared tag definitions used across videos, games, and files.",
  MasterFnpRecommendation: "Standard Family Naturalistic Programming recommendation templates.",
};

const COLUMN_OVERRIDES = {
  Id: "Unique identifier for this record.",
  RowVersion: "Internal system field used to prevent conflicting edits. Not shown in the app.",
  CreatedBy: "Email or username of the person who created this record.",
  CreatedDateTimeUtc: "Date and time the record was created (stored in UTC).",
  UpdatedBy: "Email or username of the person who last updated this record.",
  UpdatedDateTimeUtc: "Date and time the record was last updated (stored in UTC).",
  CreatedDateTime: "Date and time the record was created.",
  Status: "Current state of the record (e.g. Active, Inactive, Pending).",
  FirstName: "Person's first name.",
  LastName: "Person's last name.",
  MiddleName: "Person's middle name.",
  Name: "Display name.",
  Email: "Email address.",
  NormalizedEmail: "Email in uppercase for matching (system use).",
  UserName: "Login username (often same as email).",
  NormalizedUserName: "Username in uppercase for matching (system use).",
  PasswordHash: "Encrypted password — never stored or shown as plain text.",
  PasswordSalt: "Security salt used with the password (system use).",
  SecurityStamp: "Security token that changes when credentials change (system use).",
  ConcurrencyStamp: "Prevents two people editing the same account at once (system use).",
  PhoneNumber: "Contact phone number.",
  PhoneNumberConfirmed: "Whether the phone number has been verified (Yes/No).",
  EmailConfirmed: "Whether the email address has been verified (Yes/No).",
  LockoutEnd: "If set, the account is locked until this date/time.",
  LockoutEnabled: "Whether the account can be locked after failed login attempts.",
  AccessFailedCount: "Number of recent failed login attempts.",
  LastLoginDateTimeUtc: "When the user last logged in.",
  LastPasswordChangeDateTimeUtc: "When the password was last changed.",
  ProfilePictureStoragePath: "File path to the profile photo in cloud storage.",
  PatientId: "Links to the child (Patient) this record belongs to.",
  AdminUserId: "Links to the staff member (AdminUser) involved.",
  CentreId: "Links to the therapy centre (Centre).",
  AllocatePatientId: "Links to the assessment assignment (AllocatePatient).",
  ClinicianUserId: "Links to the clinician (AdminUser) assigned.",
  MasterCityId: "Links to the city (MasterCity).",
  MasterStateId: "Links to the state (MasterState).",
  RoleId: "Links to a role definition.",
  UserId: "Links to a user account.",
  MasterTagId: "Links to a shared tag (MasterTag).",
  Assessment: "Type of assessment (e.g. DP3, ISAA, REELS, SPM).",
  Domain: "Developmental or clinical area (e.g. Communication, Social).",
  Goal: "The therapy goal text.",
  Objective: "A specific, measurable step toward a goal.",
  Intervention: "The therapy approach or strategy to use.",
  Progress: "Notes on how much progress has been made on a goal.",
  Answer: "The response given to an assessment question.",
  Question: "The assessment question text.",
  QuestionNumber: "The question's number or code in the assessment.",
  Description: "Longer explanatory text.",
  Title: "Short title or heading.",
  Data: "Structured or JSON data stored for reports or history sections.",
  Type: "Category or action type (e.g. Login, CaseRegistered).",
  IpAddress: "Internet address of the device used.",
  UserAgent: "Browser and device information.",
  DateOfBirth: "Date of birth.",
  Gender: "Gender.",
  Diagnosis: "Clinical diagnosis information.",
  Relation: "Relationship to the child (e.g. Mother, Father).",
  Profession: "Parent/guardian's occupation.",
  PrimaryLanguage: "Main language spoken at home.",
  SecondaryLanguage: "Additional language spoken at home.",
  SchoolName: "Name of the child's school.",
  GradeName: "School grade or class.",
  OrderOfBirth: "Birth order among siblings (1 = first born).",
  Age: "Child's age (may be calculated from date of birth).",
  PatientID: "Human-readable child ID shown in the app (e.g. case number).",
  UserID: "Human-readable staff ID shown in the app.",
  LicenseNumber: "Professional license number (for clinicians).",
  ClinicianSpecialization: "Clinician's area of specialisation.",
  CentreName: "Name of the therapy centre.",
  Address: "Street address of the centre.",
  PinCode: "Postal/ZIP code.",
  CityName: "Name of the city.",
  StateName: "Name of the state.",
  AssessmentSerialNumber: "Sequence number for this assessment on the case.",
  IsResultGenerate: "Whether assessment results have been generated (Yes/No).",
  IsGoalApprovalRequested: "Whether goal approval has been requested (Yes/No).",
  Result: "Numeric assessment result or score summary.",
  RequestId: "Reference ID for the approval request.",
  FileName: "Original file name.",
  FileSize: "File size in bytes.",
  FileStoragePath: "Cloud storage path for the file.",
  DocumentStoragePath: "Cloud storage path for an uploaded document.",
  UploadDocumentStoragePath: "Cloud storage path for a case document.",
  ReportPdfStoragePath: "Cloud storage path for a generated PDF report.",
  IfspReportStoragePath: "Cloud storage path for the IFSP report PDF.",
  Category: "Document or file category.",
  Section: "Section name within case history.",
  PublishTo: "Who can see this content (e.g. centres, parents).",
  PublishedBy: "Who published the content.",
  AgeGroup: "Target age range for content or scoring.",
  Link: "Web link (URL).",
  VideoUrl: "Direct video URL.",
  YoutubeUrl: "YouTube video URL.",
  Source: "Where the video comes from (upload vs YouTube).",
  ThumbNailImagePath: "Path to thumbnail image.",
  ThumbNailImageFileName: "Thumbnail file name.",
  TagColor: "Display colour for a tag.",
  Recommendation: "Recommended action or guidance text.",
  Heading: "Section heading for a recommendation.",
  Guideline: "Clinical guideline text.",
  GeneratedBy: "Who generated the report.",
  GeneratedOn: "Date the report was generated.",
  Skill: "Skill area being targeted.",
  Baseline: "Starting skill level before therapy.",
  BaseLine: "Starting skill level before therapy.",
  Activity: "Planned therapy activity.",
  ProblemStatement: "Description of the problem or need area.",
  Intervention: "Therapy intervention text.",
  SkillTag: "Tag describing a skill area.",
  Level: "Severity or skill level number.",
  TScore: "Standardised T-score from SPM scoring.",
  PercentileRank: "Percentile rank for a score.",
  StandardScore: "Standardised score.",
  RawScore: "Raw (unadjusted) score.",
  DescriptiveCategory: "Label describing a score range (e.g. 'Below Average').",
  SumOfStandardScores: "Combined standard scores.",
  GeneralDevelopmentScore: "Overall developmental score.",
  Physical: "Physical development domain score or label.",
  AdaptiveBehavior: "Adaptive behaviour domain score or label.",
  SocialEmotional: "Social-emotional domain score or label.",
  Cognitive: "Cognitive domain score or label.",
  Communication: "Communication domain score or label.",
  MinimumAge: "Minimum age for this rule or question.",
  MaximumAge: "Maximum age for this rule or question.",
  MinimumYear: "Minimum age in years.",
  MaximumYear: "Maximum age in years.",
  MinimumMonth: "Minimum age in months.",
  MaximumMonth: "Maximum age in months.",
  AgeMinimumYear: "Minimum age (years) for scoring lookup.",
  AgeMinimumMonth: "Minimum age (months) for scoring lookup.",
  AgeMaximumYear: "Maximum age (years) for scoring lookup.",
  AgeMaximumMonth: "Maximum age (months) for scoring lookup.",
  AgeYear: "Age in years for lookup tables.",
  MinStandardScore: "Lower bound of a score range.",
  MaxStandardScore: "Upper bound of a score range.",
  MinSumOfStandardScore: "Minimum sum of standard scores for a range.",
  MaxSumOfStandardScore: "Maximum sum of standard scores for a range.",
  DeviceId: "Unique ID of the trusted device.",
  DeviceName: "Friendly name of the device.",
  IsActive: "Whether this record is currently active (Yes/No).",
  NormalizedName: "Name in uppercase for matching (system use).",
  Summary: "Short summary of what changed.",
  ActualAttemptQuestionMinimumAge: "Youngest age band attempted in REELS.",
  ActualAttemptQuestionMaximumAge: "Oldest age band attempted in REELS.",
};

function parseSchema(text) {
  const lines = text.split("\n");
  const tables = [];
  const columns = {};
  let inTables = false;
  let inColumns = false;

  for (const line of lines) {
    if (line.includes("Query 1")) {
      inTables = true;
      inColumns = false;
      continue;
    }
    if (line.includes("Query 2")) {
      inTables = false;
      inColumns = true;
      continue;
    }
    if (line.includes("Query 3")) break;

    if (inTables) {
      const m = line.match(/^\s{2}([A-Za-z][A-Za-z0-9_]*)\s*$/);
      if (m && !m[1].includes("-")) tables.push(m[1].trim());
    }

    if (inColumns) {
      const m = line.match(/^\s{2}([A-Za-z][^\|]+?)\s+\|\s{2}([A-Za-z][^\|]+?)\s+\|\s{2}([a-z]+)\s*$/);
      if (m) {
        const table = m[1].trim();
        const column = m[2].trim();
        const dataType = m[3].trim();
        if (!columns[table]) columns[table] = [];
        columns[table].push({ column, dataType });
      }
    }
  }

  return { tables: tables.filter((t) => !SKIP_TABLES.has(t)), columns };
}

function friendlyType(sqlType) {
  const map = {
    bigint: "Whole number (ID or count)",
    int: "Whole number",
    bit: "Yes / No",
    nvarchar: "Text",
    varchar: "Text",
    date: "Date only",
    datetime: "Date and time",
    datetimeoffset: "Date and time (with timezone)",
    decimal: "Decimal number",
    timestamp: "System version stamp",
  };
  return map[sqlType] || sqlType;
}

function splitCamelCase(name) {
  return name
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/\bId\b$/, "ID")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function describeColumn(column, table) {
  if (COLUMN_OVERRIDES[column]) return COLUMN_OVERRIDES[column];

  if (column.endsWith("Id") && column !== "UserID" && column !== "PatientID" && column !== "RequestId") {
    const ref = column.replace(/Id$/, "");
    const refTable = ref === "User" ? "user" : ref === "Admin" ? "staff member" : splitCamelCase(ref);
    return `Links to ${refTable} (reference ID).`;
  }

  if (column.startsWith("MasterPatient")) {
    return `Reference to master template: ${splitCamelCase(column)}.`;
  }

  if (column.includes("StoragePath") || column.includes("FileStorage")) {
    return "File location in cloud storage (not a web link by itself).";
  }

  if (column.startsWith("Minimum") || column.startsWith("Maximum") || column.startsWith("Min") || column.startsWith("Max")) {
    return `${splitCamelCase(column)} — used in scoring or age rules.`;
  }

  if (column.includes("Skill") || column.includes("Activity")) {
    return `${splitCamelCase(column)} — related to therapy skills or activities.`;
  }

  return `${splitCamelCase(column)}.`;
}

function friendlyTableName(table) {
  return splitCamelCase(
    table
      .replace(/^MasterPatient/, "Master Patient ")
      .replace(/^Master/, "Reference ")
  ).replace(/\s{2,}/g, " ");
}

function slug(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function buildToc(categories, allTables, columns) {
  let toc = "## Table of contents\n\n";
  for (const cat of categories) {
    if (cat.id === "overview") continue;
    toc += `- [${cat.title}](#${slug(cat.title)})\n`;
    for (const t of cat.tables) {
      if (columns[t]) toc += `  - [${friendlyTableName(t)}](#${slug(t)})\n`;
    }
  }
  const uncategorized = allTables.filter(
    (t) => !categories.some((c) => c.tables.includes(t))
  );
  if (uncategorized.length) {
    toc += `- [Other tables](#other-tables)\n`;
    for (const t of uncategorized) toc += `  - [${friendlyTableName(t)}](#${slug(t)})\n`;
  }
  return toc + "\n";
}

function renderTableSection(table, cols) {
  let md = `### ${friendlyTableName(table)} {#${slug(table)}}\n\n`;
  md += `**Database table:** \`${table}\`\n\n`;
  md += `${TABLE_DESCRIPTIONS[table] || "Stores data related to " + friendlyTableName(table).toLowerCase() + "."}\n\n`;
  md += `| Column | What it means | Type |\n`;
  md += `|--------|---------------|------|\n`;
  for (const { column, dataType } of cols) {
    md += `| **${splitCamelCase(column)}** | ${describeColumn(column, table)} | ${friendlyType(dataType)} |\n`;
  }
  md += "\n";
  return md;
}

function main() {
  const text = fs.readFileSync(INPUT, "utf8");
  const { tables, columns } = parseSchema(text);

  const categorized = new Set(TABLE_CATEGORIES.flatMap((c) => c.tables));
  const uncategorized = tables.filter((t) => !categorized.has(t));

  let md = `# Unity Database — Data Dictionary\n\n`;
  md += `> **For:** Operations, clinical leads, and non-technical stakeholders  \n`;
  md += `> **Database:** UnityDb (Azure SQL)  \n`;
  md += `> **Generated:** ${new Date().toISOString().slice(0, 10)}  \n`;
  md += `> **Tables documented:** ${tables.length}\n\n`;
  md += `---\n\n`;

  md += `## What is this document?\n\n`;
  md += `This guide explains **what information Unity stores** and **what each field means**, in plain language.\n\n`;
  md += `- A **table** is like a spreadsheet — one topic per sheet (e.g. "Children", "Staff", "Assessments").\n`;
  md += `- A **column** is a field on that sheet (e.g. "First Name", "Date of Birth").\n`;
  md += `- **Master** tables hold templates and lookup rules used by the app — they are not individual child records.\n`;
  md += `- **Patient** in the database means **child** — the person receiving therapy services.\n\n`;

  md += `### Key concepts\n\n`;
  md += `| Term in the app | What the database calls it |\n`;
  md += `|-----------------|---------------------------|\n`;
  md += `| Child / case | Patient |\n`;
  md += `| Parent / guardian | PatientParent |\n`;
  md += `| Staff / clinician | AdminUser |\n`;
  md += `| Therapy centre / clinic | Centre |\n`;
  md += `| Assessment assignment | AllocatePatient |\n`;
  md += `| Family Service Plan | FSP (PatientFsp… tables) |\n`;
  md += `| FNP goals | Family Naturalistic Programming goals |\n\n`;

  md += `### Data types (simplified)\n\n`;
  md += `| Type shown | What it means |\n`;
  md += `|------------|---------------|\n`;
  md += `| Text | Words, names, descriptions, statuses |\n`;
  md += `| Whole number | Counts, IDs, scores without decimals |\n`;
  md += `| Decimal number | Scores that can have fractions |\n`;
  md += `| Yes / No | True or false (e.g. email verified?) |\n`;
  md += `| Date only | Calendar date (no time) |\n`;
  md += `| Date and time | When something happened |\n\n`;

  md += `### Common columns you'll see everywhere\n\n`;
  md += `Most tables include some of these standard fields:\n\n`;
  md += `| Column | Meaning |\n`;
  md += `|--------|--------|\n`;
  md += `| Id | Unique record number (internal) |\n`;
  md += `| CreatedBy / UpdatedBy | Who created or last changed the record |\n`;
  md += `| CreatedDateTimeUtc / UpdatedDateTimeUtc | When it was created or updated |\n`;
  md += `| Status | Whether the record is active, pending, etc. |\n`;
  md += `| RowVersion | Internal — prevents edit conflicts; ignore for reporting |\n\n`;

  md += `---\n\n`;
  md += buildToc(TABLE_CATEGORIES, tables, columns);

  md += `## Quick reference — all tables by category\n\n`;
  for (const cat of TABLE_CATEGORIES) {
    if (cat.id === "overview") continue;
    md += `### ${cat.title}\n\n`;
    if (cat.description) md += `${cat.description}\n\n`;
    md += `| Table | Plain-English name | Purpose |\n`;
    md += `|-------|-------------------|--------|\n`;
    for (const t of cat.tables) {
      if (!columns[t]) continue;
      md += `| \`${t}\` | ${friendlyTableName(t)} | ${TABLE_DESCRIPTIONS[t] || "—"} |\n`;
    }
    md += `\n`;
  }

  md += `---\n\n`;

  for (const cat of TABLE_CATEGORIES) {
    if (cat.id === "overview") continue;
    md += `## ${cat.title} {#${slug(cat.title)}}\n\n`;
    if (cat.description) md += `${cat.description}\n\n`;
    for (const t of cat.tables) {
      if (columns[t]) md += renderTableSection(t, columns[t]);
    }
  }

  if (uncategorized.length) {
    md += `## Other tables {#other-tables}\n\n`;
    for (const t of uncategorized) {
      if (columns[t]) md += renderTableSection(t, columns[t]);
    }
  }

  md += `---\n\n`;
  md += `## Glossary\n\n`;
  md += `| Abbreviation | Full name | What it is |\n`;
  md += `|--------------|-----------|------------|\n`;
  md += `| DP-3 | Developmental Profile 3 | Developmental assessment tool |\n`;
  md += `| ISAA | Indian Scale for Assessment of Autism | Autism screening/assessment scale |\n`;
  md += `| REELS | Receptive-Expressive Emergent Language Scale | Language development assessment |\n`;
  md += `| SPM | Sensory Processing Measure | Sensory profile assessment |\n`;
  md += `| FSP | Family Service Plan | Structured therapy plan with goals and interventions |\n`;
  md += `| FNP | Family Naturalistic Programming | Home-based therapy approach with goals |\n`;
  md += `| IFSP | Individualized Family Service Plan | Formal plan document for early intervention |\n`;
  md += `| CMS | Content Management System | Portal for managing videos, games, and files |\n`;
  md += `| UTC | Coordinated Universal Time | Standard timezone used for timestamps |\n\n`;

  md += `---\n\n`;
  md += `*This document was auto-generated from the live database schema. For technical schema dumps, see \`schema-dump.txt\`.*\n`;

  fs.writeFileSync(OUTPUT, md, "utf8");

  const colCount = Object.values(columns).reduce((n, c) => n + c.length, 0);
  console.log(`Wrote ${OUTPUT}`);
  console.log(`Tables: ${tables.length}, Columns: ${colCount}, Size: ${(md.length / 1024).toFixed(1)} KB`);
}

main();
