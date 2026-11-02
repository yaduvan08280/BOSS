import type { OrgDepartment, OrgPerson } from '@mono/shared';

/** Everyone in a department: main department or "also works in". */
export function membersOf(people: OrgPerson[], deptId: string) {
  return people.filter(
    (p) => p.status !== 'LEFT' && (p.mainDepartmentId === deptId || p.alsoWorksIn.includes(deptId)),
  );
}

export function childrenOf(departments: OrgDepartment[], id: string | null) {
  return departments.filter((d) => d.parentId === id);
}

/** Body for PATCH /users/:id that takes the person out of one department. */
export function leaveDepartment(person: OrgPerson, deptId: string, fallback: string | null) {
  if (person.mainDepartmentId === deptId) {
    return { mainDepartmentId: fallback, alsoWorksIn: person.alsoWorksIn.filter((d) => d !== fallback) };
  }
  return { alsoWorksIn: person.alsoWorksIn.filter((d) => d !== deptId) };
}
