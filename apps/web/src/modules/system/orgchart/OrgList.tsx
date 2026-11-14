import type { OrgDepartment, OrgPerson } from '@mono/shared';
import { Who } from '@/components/brand';
import { Card } from '@/components/ui/card';
import { membersOf } from '../departments/members';

/** The organisation as plain lists: one card per department (the phone-friendly view). */
export function OrgList({
  columns,
  people,
  onOpen,
}: {
  columns: OrgDepartment[];
  people: OrgPerson[];
  onOpen: (p: OrgPerson) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
      {columns.map((d) => {
        const members = membersOf(people, d.id);
        return (
          <Card key={d.id} className="p-3">
            <div className="mb-2 flex items-center justify-between text-sm font-semibold">
              {d.name} <span className="tabular text-xs text-muted-foreground">{members.length}</span>
            </div>
            <div className="space-y-1.5">
              {members.map((p) => (
                <button
                  key={p.id}
                  onClick={() => onOpen(p)}
                  className="flex min-h-11 w-full items-center justify-between gap-2 rounded-control px-2 py-1.5 text-left text-sm hover:bg-muted"
                >
                  <span className="min-w-0">
                    <Who id={p.id} name={p.name} />
                    {p.branchName && (
                      <span className="block truncate pl-[26px] text-[11px] text-muted-foreground">
                        {p.branchName}
                      </span>
                    )}
                  </span>
                  {p.id === d.hodUserId && (
                    <span className="rounded-pill bg-accent px-1.5 text-[10px] font-bold text-accent-foreground">
                      HOD
                    </span>
                  )}
                </button>
              ))}
            </div>
          </Card>
        );
      })}
    </div>
  );
}
