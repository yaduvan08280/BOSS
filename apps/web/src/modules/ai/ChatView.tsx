import { Bot, ChevronDown, Loader2, Send, Sparkles } from 'lucide-react';
import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { formatDateTime } from '@mono/shared';
import { DictateButton } from '@/components/dictate';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useChat, useSend, type ChatMessage, type ChatTable } from './chatApi';

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

/** **bold**, *italic* and `code` inside a line — built as elements, never as HTML. */
function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|`[^`]+`)/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index! > last) out.push(text.slice(last, m.index));
    const s = m[0];
    if (s.startsWith('**')) out.push(<strong key={m.index}>{s.slice(2, -2)}</strong>);
    else if (s.startsWith('`'))
      out.push(
        <code key={m.index} className="rounded bg-muted px-1 text-[0.9em]">
          {s.slice(1, -1)}
        </code>,
      );
    else out.push(<em key={m.index}>{s.slice(1, -1)}</em>);
    last = m.index! + s.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** The assistant's answer: paragraphs, headings and lists from its Markdown. */
export function Md({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const flush = () => {
    if (!list) return;
    const L = list.ordered ? 'ol' : 'ul';
    blocks.push(
      <L key={blocks.length} className={cn('space-y-1 pl-5', list.ordered ? 'list-decimal' : 'list-disc')}>
        {list.items.map((i, k) => (
          <li key={k}>{inline(i)}</li>
        ))}
      </L>,
    );
    list = null;
  };
  for (const raw of text.split('\n')) {
    const line = raw.trimEnd();
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
    const num = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (bullet || num) {
      const ordered = Boolean(num);
      if (!list || list.ordered !== ordered) {
        flush();
        list = { ordered, items: [] };
      }
      list.items.push((bullet ?? num)![1]!);
      continue;
    }
    flush();
    if (!line.trim()) continue;
    const head = /^#{1,4}\s+(.*)$/.exec(line);
    blocks.push(
      head ? (
        <p key={blocks.length} className="font-semibold">
          {inline(head[1]!)}
        </p>
      ) : (
        <p key={blocks.length}>{inline(line)}</p>
      ),
    );
  }
  flush();
  return <div className="space-y-2 leading-relaxed">{blocks}</div>;
}

function TableCard({ table, tz }: { table: ChatTable; tz: string }) {
  const { t } = useTranslation();
  const cols = table.columns.filter((c) => c !== 'link');
  const show = (v: unknown) => {
    if (v === null || v === undefined || v === '') return '—';
    if (typeof v === 'boolean') return v ? t('fms.yes') : t('fms.no');
    if (typeof v === 'number') return v.toLocaleString('en-IN');
    if (typeof v === 'string' && ISO.test(v)) return formatDateTime(v, tz);
    return String(v);
  };
  return (
    <div className="overflow-hidden rounded-control border">
      <div className="flex items-center justify-between bg-muted/60 px-3 py-1.5 text-xs text-muted-foreground">
        <span className="font-medium">{table.label}</span>
        <span>{t('chat.rows', { count: table.total })}</span>
      </div>
      <div className="max-h-72 overflow-auto">
        <table className="w-full min-w-max text-xs tabular-nums">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              {cols.map((c) => (
                <th key={c} className="px-3 py-1.5 font-medium">
                  {t(`ai.col.${c}`, { defaultValue: c.replace(/_/g, ' ') })}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((r, i) => (
              <tr key={i} className="border-b last:border-0">
                {cols.map((c, k) => (
                  <td key={c} className="px-3 py-1.5">
                    {k === 0 && typeof r.link === 'string' ? (
                      <Link to={r.link} className="underline underline-offset-2">
                        {show(r[c])}
                      </Link>
                    ) : (
                      show(r[c])
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Answer({ m, tz }: { m: ChatMessage; tz: string }) {
  const { t } = useTranslation();
  const steps = m.data?.steps ?? [];
  return (
    <div className="flex gap-3">
      <div className="grid size-8 shrink-0 place-items-center rounded-full bg-accent-soft text-accent-soft-foreground">
        <Bot className="size-4" />
      </div>
      <div className="min-w-0 flex-1 space-y-3 text-[15px]">
        <Md text={m.content} />
        {m.data?.table && <TableCard table={m.data.table} tz={tz} />}
        {steps.length > 0 && (
          <details className="group text-xs text-muted-foreground">
            <summary className="flex cursor-pointer list-none items-center gap-1">
              <ChevronDown className="size-3.5 transition group-open:rotate-180" />
              {t('chat.howWorked', { count: steps.length })}
            </summary>
            <ol className="mt-1.5 space-y-0.5 pl-5">
              {steps.map((s, i) => (
                <li key={i} className="list-decimal">
                  {s.purpose}
                  {s.kind === 'lookup'
                    ? ` · ${t('chat.rows', { count: s.rows ?? 0 })}`
                    : s.result
                      ? ` · ${s.result}`
                      : ''}
                </li>
              ))}
            </ol>
          </details>
        )}
      </div>
    </div>
  );
}

/** "Looking at the data…", then how long it has been: big questions take several look-ups. */
function Elapsed() {
  const { t } = useTranslation();
  const [secs, setSecs] = useState(0);
  useEffect(() => {
    const started = Date.now();
    const timer = setInterval(() => setSecs(Math.round((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, []);
  return <>{secs < 15 ? t('chat.thinking') : t('chat.stillThinking', { secs })}</>;
}

/** A conversation with the assistant: answers from MONO's data, in English, Hindi or Hinglish. */
export function ChatView({
  chatId,
  onChat,
  tz,
  owner,
  compact,
}: {
  chatId: string | null;
  onChat: (id: string) => void;
  tz: string;
  owner: boolean;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const chat = useChat(chatId);
  const { send, pending, error } = useSend(chatId, onChat);
  const [text, setText] = useState('');
  const end = useRef<HTMLDivElement>(null);
  const messages = chatId ? (chat.data?.messages ?? []) : [];
  const last = messages[messages.length - 1];

  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [messages.length, pending]);

  const ask = (q: string) => {
    const v = q.trim();
    if (!v || pending) return;
    setText('');
    void send(v);
  };
  const examples = owner
    ? (['sales', 'stock', 'late', 'owed', 'foodCost'] as const)
    : (['myTasks', 'myAttendance', 'myLeave'] as const);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className={cn('min-h-0 flex-1 space-y-6 overflow-y-auto', compact ? 'px-4 py-4' : 'px-1 py-4')}>
        {!messages.length && !pending && (
          <div className="space-y-4 py-6">
            <div className="flex items-center gap-3">
              <div className="grid size-11 place-items-center rounded-card bg-accent-soft text-accent-soft-foreground">
                <Sparkles className="size-5" />
              </div>
              <div>
                <p className="font-semibold">{t('chat.hello')}</p>
                <p className="text-sm text-muted-foreground">
                  {owner ? t('chat.ownerHint') : t('chat.staffHint')}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {examples.map((k) => (
                <button
                  key={k}
                  onClick={() => ask(t(`chat.example.${k}`))}
                  className="rounded-pill border bg-card px-3 py-1.5 text-left text-sm hover:bg-muted"
                >
                  {t(`chat.example.${k}`)}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m) =>
          m.role === 'user' ? (
            <div key={m.id} className="flex justify-end">
              <p className="max-w-[85%] whitespace-pre-wrap rounded-card rounded-br-sm bg-primary px-3.5 py-2 text-[15px] text-primary-foreground">
                {m.content}
              </p>
            </div>
          ) : (
            <Answer key={m.id} m={m} tz={tz} />
          ),
        )}
        {pending && (
          <Fragment>
            <div className="flex justify-end">
              <p className="max-w-[85%] whitespace-pre-wrap rounded-card rounded-br-sm bg-primary px-3.5 py-2 text-[15px] text-primary-foreground">
                {pending}
              </p>
            </div>
            <p className="flex items-center gap-2 text-sm text-muted-foreground" aria-live="polite">
              <Loader2 className="size-4 animate-spin" />
              <Elapsed />
            </p>
          </Fragment>
        )}
        {error && <p className="text-sm text-status-bad-fg">{error}</p>}
        {!pending && last?.role === 'assistant' && (last.data?.suggestions.length ?? 0) > 0 && (
          <div className="flex flex-wrap gap-2 pl-11">
            {last.data!.suggestions.map((s) => (
              <button
                key={s}
                onClick={() => ask(s)}
                className="rounded-pill border bg-card px-3 py-1.5 text-left text-sm hover:bg-muted"
              >
                {s}
              </button>
            ))}
          </div>
        )}
        <div ref={end} />
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          ask(text);
        }}
        className={cn('flex items-end gap-2 border-t bg-background pt-3', compact ? 'px-4 pb-4' : 'pb-1')}
      >
        <textarea
          value={text}
          rows={1}
          maxLength={2000}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              ask(text);
            }
          }}
          placeholder={t('chat.placeholder')}
          aria-label={t('chat.placeholder')}
          className="max-h-40 min-h-11 min-w-0 flex-1 resize-none rounded-control border bg-card px-3 py-2.5 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <DictateButton onText={(s) => setText((v) => (v ? `${v} ${s}` : s))} lang="hi" />
        <Button
          type="submit"
          variant="primary"
          size="icon"
          disabled={!text.trim() || Boolean(pending)}
          aria-label={t('chat.send')}
        >
          <Send />
        </Button>
      </form>
    </div>
  );
}
