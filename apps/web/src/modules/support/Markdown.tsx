import { Fragment, type ReactNode } from 'react';

/**
 * A small Markdown renderer for MONO's own guides (docs/guide): headings, paragraphs, lists, tables, code blocks,
 * **bold**, `code` and [links](…). Everything is rendered as React text — no HTML from the file is ever inserted.
 */
function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index! > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith('**')) out.push(<strong key={m.index}>{tok.slice(2, -2)}</strong>);
    else if (tok.startsWith('`'))
      out.push(
        <code key={m.index} className="rounded bg-muted px-1 font-mono text-[0.9em]">
          {tok.slice(1, -1)}
        </code>,
      );
    else {
      const [, label, href] = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(tok)!;
      // Links between guides stay inside the app; anything else opens safely in a new tab.
      const guide = /^(\d\d-[\w-]+)\.md$/.exec(href!);
      out.push(
        guide ? (
          <a key={m.index} href={`/support/guide/${guide[1]}`} className="underline">
            {label}
          </a>
        ) : /^https?:\/\//.test(href!) ? (
          <a key={m.index} href={href} target="_blank" rel="noreferrer" className="underline">
            {label}
          </a>
        ) : (
          label
        ),
      );
    }
    last = m.index! + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ source }: { source: string }) {
  const lines = source.replace(/\r/g, '').split('\n');
  const blocks: ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.trim()) {
      i++;
      continue;
    }
    if (line.startsWith('```')) {
      const body: string[] = [];
      for (i++; i < lines.length && !lines[i]!.startsWith('```'); i++) body.push(lines[i]!);
      i++;
      blocks.push(
        <pre
          key={i}
          className="overflow-x-auto rounded-control bg-muted p-3 font-mono text-xs print:whitespace-pre-wrap"
        >
          {body.join('\n')}
        </pre>,
      );
      continue;
    }
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) {
      const level = h[1]!.length;
      const cls =
        level === 1
          ? 'text-2xl font-semibold'
          : level === 2
            ? 'mt-6 text-lg font-semibold'
            : 'mt-4 font-semibold';
      const Tag = `h${level}` as 'h1' | 'h2' | 'h3';
      blocks.push(
        <Tag key={i} className={cls}>
          {inline(h[2]!)}
        </Tag>,
      );
      i++;
      continue;
    }
    if (line.startsWith('|')) {
      const rows: string[][] = [];
      for (; i < lines.length && lines[i]!.startsWith('|'); i++)
        if (!/^\|\s*-/.test(lines[i]!))
          rows.push(
            lines[i]!.slice(1, -1)
              .split('|')
              .map((c) => c.trim()),
          );
      const [head, ...body] = rows;
      blocks.push(
        <div key={i} className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                {head!.map((c, k) => (
                  <th key={k} className="border-b px-2 py-1.5 text-left font-medium">
                    {inline(c)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {body.map((r, k) => (
                <tr key={k}>
                  {r.map((c, n) => (
                    <td key={n} className="border-b px-2 py-1.5 align-top">
                      {inline(c)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }
    if (/^(\s*[-*]|\s*\d+\.)\s/.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const items: string[] = [];
      for (; i < lines.length && /^(\s*[-*]|\s*\d+\.|\s{2,}\S)/.test(lines[i]!) && lines[i]!.trim(); i++) {
        const l = lines[i]!;
        if (/^(\s*[-*]|\s*\d+\.)\s/.test(l)) items.push(l.replace(/^\s*([-*]|\d+\.)\s+/, ''));
        else items[items.length - 1] += ` ${l.trim()}`;
      }
      const List = ordered ? 'ol' : 'ul';
      blocks.push(
        <List key={i} className={`${ordered ? 'list-decimal' : 'list-disc'} space-y-1 pl-6`}>
          {items.map((it, k) => (
            <li key={k}>{inline(it)}</li>
          ))}
        </List>,
      );
      continue;
    }
    const para: string[] = [];
    for (; i < lines.length && lines[i]!.trim() && !/^(#|```|\||\s*[-*]\s|\s*\d+\.\s)/.test(lines[i]!); i++)
      para.push(lines[i]!.trim());
    blocks.push(<p key={i}>{inline(para.join(' '))}</p>);
  }
  return (
    <div className="space-y-3 leading-relaxed">
      {blocks.map((b, k) => (
        <Fragment key={k}>{b}</Fragment>
      ))}
    </div>
  );
}
