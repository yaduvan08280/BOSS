import type { OrgPerson } from '@mono/shared';

/** "Ramesh Gurjar · Truck Driver · Dispatch" — names alone are easy to mix up in a list. */
export function personLabel(p: Pick<OrgPerson, 'name' | 'designationName' | 'mainDepartmentName'>): string {
  return [p.name, p.designationName, p.mainDepartmentName].filter(Boolean).join(' · ');
}
