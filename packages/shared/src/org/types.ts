import type { UserStatus } from '../enums';

/** Response shapes for the org module, shared by API and web. */
export type OrgPerson = {
  id: string;
  code: string;
  name: string;
  mobile: string | null;
  email: string | null;
  status: UserStatus;
  loginEnabled: boolean;
  roleId: string;
  roleName: string;
  roleKey: string | null;
  mainDepartmentId: string | null;
  designationId: string | null;
  designationName: string | null;
  reportsToId: string | null;
  reportsToName: string | null;
  branchId: string | null;
  shiftId: string | null;
  alsoWorksIn: string[];
  hodOf: string[];
  avatarUrl: string | null;
  telegramLinked: boolean;
  hr?: Record<string, unknown>;
};

export type OrgDepartment = {
  id: string;
  name: string;
  parentId: string | null;
  color: string | null;
  hodUserId: string | null;
  peopleCount: number;
  withLogin: number;
};

export type SystemSummary = {
  company: { stepsDone: number; stepsTotal: number; people: number; departments: number };
  engine: { modules: number };
  processes: { total: number; live: number; building: number; notStarted: number };
  people: { heavy: number; balanced: number; light: number; free: number; inProcess: number; total: number };
  health: { percent: number; ready: number; checks: number; gaps: { key: string; count: number }[] };
  counts: Record<string, number>;
};
