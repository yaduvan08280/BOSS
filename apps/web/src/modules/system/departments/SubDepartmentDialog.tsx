import { Plus, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { OrgDepartment, OrgPerson } from '@mono/shared';
import { personLabel } from '@/lib/people';
import { Avatar } from '@/components/brand';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Select } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { del, patch, post, useOrgMutation } from '../api';
import { childrenOf, leaveDepartment, membersOf } from './members';

type Props = {
  deptId: string;
  all: OrgDepartment[];
  people: OrgPerson[];
  onClose: () => void;
  onOpen: (id: string) => void;
};

/** Sub-department: name, head, people taken from the parent, nested sub-departments (CLAUDE.md §4.2). */
export function SubDepartmentDialog({ deptId, all, people, onClose, onOpen }: Props) {
  const { t } = useTranslation();
  const dept = all.find((d) => d.id === deptId);
  const [newSub, setNewSub] = useState('');
  const [adding, setAdding] = useState('');
  const update = useOrgMutation((body: { name?: string; hodUserId?: string | null }) =>
    patch(`/api/org/departments/${deptId}`, body),
  );
  const addSub = useOrgMutation((name: string) => post('/api/org/departments', { name, parentId: deptId }));
  const addPerson = useOrgMutation((userId: string) =>
    post('/api/org/chart/move', { userId, toDepartmentId: deptId, mode: 'also' }),
  );
  const removePerson = useOrgMutation(({ id, body }: { id: string; body: unknown }) =>
    patch(`/api/org/users/${id}`, body),
  );
  const remove = useOrgMutation(() => del(`/api/org/departments/${deptId}`), { success: t('org.deleted') });
  if (!dept) return null;

  const members = membersOf(people, dept.id);
  const parentMembers = dept.parentId
    ? membersOf(people, dept.parentId).filter((p) => !members.includes(p))
    : [];
  const subs = childrenOf(all, dept.id);
  const empty = members.length === 0 && subs.length === 0;

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('org.departments.subTitle')}
      description={all.find((d) => d.id === dept.parentId)?.name}
      footer={
        <>
          <Button
            variant="ghost"
            className="mr-auto text-status-bad-fg"
            disabled={!empty}
            title={empty ? undefined : t('org.departments.deleteBody')}
            onClick={() => remove.mutate(undefined, { onSuccess: onClose })}
          >
            <Trash2 /> {t('org.delete')}
          </Button>
          <Button variant="primary" onClick={onClose}>
            {t('org.done')}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <Field label={t('org.name')}>
          <Input
            defaultValue={dept.name}
            onBlur={(e) =>
              e.target.value.trim() &&
              e.target.value !== dept.name &&
              update.mutate({ name: e.target.value.trim() })
            }
          />
        </Field>
        <Field label={t('org.departments.teamLead')}>
          <Select
            value={dept.hodUserId ?? ''}
            onChange={(e) => update.mutate({ hodUserId: e.target.value || null })}
          >
            <option value="">{t('org.departments.noHod')}</option>
            {[...members, ...parentMembers].map((p) => (
              <option key={p.id} value={p.id}>
                {personLabel(p)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('org.departments.addFromParent')}>
          <div className="flex gap-2">
            <Select value={adding} onChange={(e) => setAdding(e.target.value)}>
              <option value="">
                {parentMembers.length ? t('org.choose') : t('org.departments.nobodyLeft')}
              </option>
              {parentMembers.map((p) => (
                <option key={p.id} value={p.id}>
                  {personLabel(p)}
                </option>
              ))}
            </Select>
            <Button
              disabled={!adding}
              onClick={() => addPerson.mutate(adding, { onSuccess: () => setAdding('') })}
            >
              <Plus /> {t('org.add')}
            </Button>
          </div>
        </Field>
        <div>
          <div className="mb-2 text-sm font-medium">{t('org.departments.peopleIn')}</div>
          {members.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('org.departments.noPeople')}</p>
          ) : (
            <ul className="divide-y rounded-control border">
              {members.map((p) => (
                <li key={p.id} className="flex items-center gap-3 px-3 py-2">
                  <Avatar name={p.name} url={p.avatarUrl} className="size-8" />
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {p.name} <span className="text-xs text-muted-foreground">{p.designationName}</span>
                  </span>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t('org.remove')}
                    onClick={() =>
                      removePerson.mutate({ id: p.id, body: leaveDepartment(p, dept.id, dept.parentId) })
                    }
                  >
                    <X />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <div className="mb-2 text-sm font-medium">{t('org.departments.nestedSubs')}</div>
          <div className="flex flex-wrap gap-1.5">
            {subs.map((s) => (
              <button
                key={s.id}
                onClick={() => onOpen(s.id)}
                className="h-8 rounded-pill bg-accent-soft px-3 text-xs font-medium text-accent-soft-foreground"
              >
                {s.name} · {s.peopleCount}
              </button>
            ))}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (newSub.trim()) addSub.mutate(newSub.trim(), { onSuccess: () => setNewSub('') });
              }}
            >
              <Input
                value={newSub}
                onChange={(e) => setNewSub(e.target.value)}
                placeholder={t('org.departments.subPh')}
                className="h-8 w-44 sm:h-8"
              />
            </form>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
