import { ArrowLeft, CircleAlert, CircleCheck, Loader2, RotateCcw, Sparkles, Wand2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { AI_FLOW_EXAMPLES, hasPermission, wordCount, type Me } from '@mono/shared';
import { DictateButton } from '@/components/dictate';
import { PageHeader } from '@/components/page';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox, Field, Select, Textarea } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { personLabel } from '@/lib/people';
import { useDepartments, useUsers } from '@/modules/system/api';
import { FmsChart } from '@/modules/fms/FmsChart';
import { aiApi, useAiMutation, useAiStatus, type FlowDraftResult } from './api';

const LANGS = ['en', 'hi', 'hinglish'] as const;
const MIN_WORDS = 30;

/** FMS Builder → Build with AI (CLAUDE.md §13): describe the work, review the draft, open it in the builder. */
export function BuildWithAiPage({ me }: { me: Me }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const status = useAiStatus();
  const depts = useDepartments();
  const users = useUsers();
  const [lang, setLang] = useState<(typeof LANGS)[number]>('en');
  const [text, setText] = useState('');
  const [name, setName] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [result, setResult] = useState<FlowDraftResult | null>(null);
  const [changes, setChanges] = useState('');
  const [keep, setKeep] = useState<Set<string>>(new Set());
  const words = wordCount(text);
  const names = useMemo(() => new Map((users.data ?? []).map((u) => [u.id, u.name])), [users.data]);
  const noop = useMemo(() => () => undefined, []);

  const draft = useAiMutation((body: Parameters<typeof aiApi.draftFlow>[0]) => aiApi.draftFlow(body));
  const open = useAiMutation(async (r: FlowDraftResult) => {
    const created = await aiApi.createFlow(r.draft, text);
    const lines = r.remember.filter((l) => keep.has(l));
    if (lines.length) await aiApi.remember(lines);
    return created;
  });
  const run = (extra: { previous?: FlowDraftResult['draft']; changes?: string } = {}) =>
    draft.mutate(
      { text, name: name || null, departmentId: departmentId || null, ...extra },
      {
        onSuccess: (r) => {
          setResult(r);
          setKeep(new Set(r.remember));
          setChanges('');
        },
      },
    );

  if (status.isSuccess && !status.data.connected)
    return (
      <div className="space-y-5">
        <PageHeader title={t('ai.build.title')} subtitle={t('ai.build.subtitle')} />
        <Card>
          <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-5">
            <p className="text-sm">{t('ai.connectFirst')}</p>
            {hasPermission(me.user.permissions, 'ai.admin') ? (
              <Button variant="primary" onClick={() => navigate('/system/integration/ai')}>
                {t('ai.openSettings')}
              </Button>
            ) : null}
          </CardContent>
        </Card>
      </div>
    );

  if (result) {
    const s = result.summary;
    return (
      <div className="space-y-5">
        <PageHeader title={t('ai.build.reviewTitle')} subtitle={result.meta.name} />
        <Card>
          <CardContent className="space-y-3 pt-5">
            <p className="text-sm font-medium">
              {t('ai.build.summary', { steps: s.steps, start: s.startFields, fields: s.stepFields })} ·{' '}
              <span className={s.unassigned ? 'text-status-warn-fg' : 'text-status-ok-fg'}>
                {s.unassigned ? t('ai.build.unassigned', { count: s.unassigned }) : t('ai.build.allAssigned')}
              </span>
            </p>
            {result.unmatched.length > 0 && (
              <div className="rounded-control bg-status-warn-bg p-3 text-sm text-status-warn-fg">
                <div className="mb-1 flex items-center gap-1.5 font-medium">
                  <CircleAlert className="size-4" /> {t('ai.build.unmatched')}
                </div>
                <ul className="flex flex-wrap gap-1.5">
                  {result.unmatched.map((u) => (
                    <li
                      key={`${u.where}-${u.name}`}
                      className="rounded-pill bg-card px-2 py-0.5 text-xs text-foreground"
                    >
                      {u.name} · {t(`ai.build.where.${u.where}`, { defaultValue: u.where })}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_380px]">
          <FmsChart
            def={result.definition}
            names={names}
            toFix={new Set(result.issues.flatMap((i) => (i.stepKey ? [i.stepKey] : [])))}
            selected={null}
            onSelect={noop}
          />
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>{t('ai.build.changesTitle')}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <Textarea
                  rows={3}
                  className="font-sans"
                  value={changes}
                  placeholder={t('ai.build.changesPlaceholder')}
                  aria-label={t('ai.build.changesTitle')}
                  onChange={(e) => setChanges(e.target.value)}
                />
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    disabled={changes.trim().length < 5 || draft.isPending}
                    onClick={() => run({ previous: result.draft, changes })}
                  >
                    {draft.isPending ? <Loader2 className="animate-spin" /> : <Wand2 />}{' '}
                    {t('ai.build.change')}
                  </Button>
                  <DictateButton
                    lang={lang === 'hi' ? 'hi' : 'en'}
                    onText={(v) => setChanges((x) => `${x} ${v}`.trim())}
                  />
                </div>
              </CardContent>
            </Card>
            {result.remember.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>{t('ai.build.remember')}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {result.remember.map((l) => (
                    <label key={l} className="flex items-start gap-2 text-sm">
                      <Checkbox
                        checked={keep.has(l)}
                        onChange={() =>
                          setKeep((k) => {
                            const n = new Set(k);
                            if (n.has(l)) n.delete(l);
                            else n.add(l);
                            return n;
                          })
                        }
                      />
                      {l}
                    </label>
                  ))}
                  <p className="text-xs text-muted-foreground">{t('ai.build.rememberHint')}</p>
                </CardContent>
              </Card>
            )}
            <div className="flex flex-wrap gap-2">
              <Button
                variant="primary"
                disabled={open.isPending}
                onClick={() => open.mutate(result, { onSuccess: (f) => navigate(`/fms/builder/${f.id}`) })}
              >
                {open.isPending && <Loader2 className="animate-spin" />} {t('ai.build.open')}
              </Button>
              <Button variant="ghost" onClick={() => setResult(null)}>
                <RotateCcw /> {t('ai.build.again')}
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader title={t('ai.build.title')} subtitle={t('ai.build.subtitle')} />
      <Link
        to="/fms/builder"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> {t('ai.build.back')}
      </Link>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_340px]">
        <Card>
          <CardHeader>
            <CardTitle>{t('ai.build.how')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={t('ai.build.language')}>
              {LANGS.map((l) => (
                <button
                  key={l}
                  type="button"
                  role="radio"
                  aria-checked={lang === l}
                  onClick={() => setLang(l)}
                  className={cn(
                    'h-9 rounded-pill border px-4 text-sm font-medium',
                    lang === l ? 'border-ink bg-ink text-ink-foreground' : 'bg-card text-muted-foreground',
                  )}
                >
                  {t(`ai.build.lang.${l}`)}
                </button>
              ))}
            </div>
            <Textarea
              className="min-h-[220px] font-sans"
              value={text}
              aria-label={t('ai.build.how')}
              placeholder={t('ai.build.placeholder')}
              onChange={(e) => setText(e.target.value)}
            />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <DictateButton
                lang={lang === 'hi' ? 'hi' : 'en'}
                onText={(v) => setText((x) => `${x} ${v}`.trim())}
              />
              <span
                className={cn(
                  'text-sm tabular-nums',
                  words >= MIN_WORDS ? 'text-status-ok-fg' : 'text-muted-foreground',
                )}
              >
                {words >= MIN_WORDS && <CircleCheck className="mr-1 inline size-4" />}
                {t('ai.build.words', { words, min: MIN_WORDS })}
              </span>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label={t('ai.build.name')}>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t('ai.build.namePlaceholder')}
                />
              </Field>
              <Field label={t('ai.build.department')}>
                <Select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
                  <option value="">{t('ai.build.anyDepartment')}</option>
                  {(depts.data ?? []).map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <Button
              variant="primary"
              disabled={text.trim().length < 10 || draft.isPending}
              onClick={() => run()}
            >
              {draft.isPending ? <Loader2 className="animate-spin" /> : <Sparkles />}{' '}
              {draft.isPending ? t('ai.build.drafting') : t('ai.build.draft')}
            </Button>
            {words > 0 && words < MIN_WORDS && (
              <p className="text-xs text-muted-foreground">{t('ai.build.moreWords')}</p>
            )}
          </CardContent>
        </Card>
        <Card className="self-start">
          <CardHeader>
            <CardTitle>{t('ai.build.examples')}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {AI_FLOW_EXAMPLES.map((ex) => (
              <Button key={ex.key} size="sm" variant="secondary" onClick={() => setText(ex.text)}>
                {t(`ai.example.${ex.key}`)}
              </Button>
            ))}
            <p className="w-full pt-1 text-xs text-muted-foreground">
              {t('ai.build.peopleHint', { example: users.data?.[0] ? personLabel(users.data[0]) : '' })}
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
