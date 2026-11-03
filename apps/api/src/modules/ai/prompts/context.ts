import type { Db, Tx } from '@mono/db';
import { formatDateTime } from '@mono/shared';

/** What every prompt knows about the company: its own words, today, people, departments, papers. */
export type CompanyContext = {
  company: string;
  timezone: string;
  now: string;
  details: string;
  people: { id: string; name: string; designation: string | null; department: string | null }[];
  departments: { id: string; name: string }[];
  documentTypes: { code: string; name: string }[];
};

export async function companyContext(db: Db | Tx, companyId: string): Promise<CompanyContext> {
  const [company, details, people, departments, documentTypes] = await Promise.all([
    db.company.findUniqueOrThrow({ where: { id: companyId }, select: { name: true, timezone: true } }),
    db.businessDetails.findUnique({ where: { companyId }, select: { text: true } }),
    db.user.findMany({
      where: { companyId, deletedAt: null, status: 'ACTIVE' },
      select: {
        id: true,
        name: true,
        designation: { select: { name: true } },
        mainDepartment: { select: { name: true } },
      },
      orderBy: { name: 'asc' },
      take: 500,
    }),
    db.department.findMany({
      where: { companyId, deletedAt: null },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
    db.documentType.findMany({
      where: { companyId, deletedAt: null, active: true },
      select: { code: true, name: true },
    }),
  ]);
  return {
    company: company.name,
    timezone: company.timezone,
    now: formatDateTime(new Date(), company.timezone),
    details: details?.text.trim() ?? '',
    people: people.map((p) => ({
      id: p.id,
      name: p.name,
      designation: p.designation?.name ?? null,
      department: p.mainDepartment?.name ?? null,
    })),
    departments,
    documentTypes,
  };
}

/** The part of the system prompt every feature shares. Stable text first, so providers can cache it. */
export function aboutCompany(c: CompanyContext, opts: { people?: boolean } = {}): string {
  const lines = [
    `Company: ${c.company}. Time zone: ${c.timezone}. Dates are written DD/MM/YYYY; money in ₹.`,
    c.details ? `\nThe company in its own words:\n<business_details>\n${c.details}\n</business_details>` : '',
  ];
  if (opts.people) {
    lines.push(
      `\nDepartments: ${c.departments.map((d) => d.name).join(', ') || 'none yet'}.`,
      `\nPeople (name · designation · department):\n${c.people
        .map((p) => `- ${[p.name, p.designation, p.department].filter(Boolean).join(' · ')}`)
        .join('\n')}`,
      `\nDocument types (code: name): ${c.documentTypes.map((d) => `${d.code}: ${d.name}`).join(', ') || 'none yet'}.`,
    );
  }
  return lines.filter(Boolean).join('\n');
}
