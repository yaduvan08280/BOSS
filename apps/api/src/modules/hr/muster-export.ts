import { formatDate } from '@mono/shared';
import { renderPdf } from '../../lib/pdf';
import { toCsv, toXlsx, type Cell } from '../records/xlsx';
import { clock, hhmm, type Muster } from './muster';

const DAY = ['', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
const hours = (min: number) => (min ? Math.round((min / 60) * 100) / 100 : 0);
const monthName = (month: string) =>
  new Date(`${month}-01T12:00:00Z`).toLocaleString('en-IN', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

/** The muster register: one row per person, one code per day, then the month's totals. */
export function musterRows(r: Muster): Cell[][] {
  const head: Cell[] = [
    'Code',
    'Name',
    'Department',
    'Designation',
    'Branch',
    ...r.days.map((d) => `${d.date.slice(8)} ${DAY[d.weekday]}`),
    'Present',
    'Late',
    'Half days',
    'Absent',
    'Leave',
    'Weekly offs',
    'Holidays',
    'No record',
    'Worked hours',
    'Late minutes',
    'Overtime hours',
  ];
  return [
    head,
    ...r.people.map((p) => [
      p.code,
      p.name,
      p.department,
      p.designation,
      p.branch,
      ...p.cells.map((c) => c.code),
      p.totals.present,
      p.totals.late,
      p.totals.halfDays,
      p.totals.absent,
      p.totals.leave,
      p.totals.weeklyOffs,
      p.totals.holidays,
      p.totals.noRecord,
      hours(p.totals.workedMin),
      p.totals.lateMin,
      hours(p.totals.overtimeMin),
    ]),
  ];
}

/** The daily punch report: one row per person per day that has anything on it. */
export function punchRows(r: Muster): Cell[][] {
  const head: Cell[] = [
    'Date',
    'Day',
    'Code',
    'Name',
    'Department',
    'Shift',
    'Status',
    'In',
    'Out',
    'Worked (h:mm)',
    'Late (min)',
    'Overtime (h:mm)',
    'All punches',
    'Remarks',
  ];
  const rows: Cell[][] = [head];
  for (const d of r.days)
    for (const p of r.people) {
      const c = p.cells.find((x) => x.date === d.date)!;
      if (c.blank || (!c.status && !c.punches.length)) continue;
      rows.push([
        formatDate(`${d.date}T12:00:00Z`, 'UTC'),
        DAY[d.weekday],
        p.code,
        p.name,
        p.department,
        p.shift,
        c.code,
        clock(c.inAt, r.tz),
        clock(c.outAt, r.tz),
        c.workedMin ? hhmm(c.workedMin) : '',
        c.lateMin || '',
        c.overtimeMin ? hhmm(c.overtimeMin) : '',
        c.punches
          .map(
            (x) =>
              `${clock(x.at, r.tz)} ${x.type}${x.flagged ? ' (flagged)' : ''}${x.source === 'app' ? '' : ` [${x.source}]`}`,
          )
          .join(', '),
        [...(c.missedOut ? ['Missed punch-out'] : []), ...(c.live ? ['Not settled yet'] : []), ...c.reasons]
          .filter((x, i, a) => a.indexOf(x) === i)
          .join('; '),
      ]);
    }
  return rows;
}

export function musterFile(r: Muster, kind: 'muster' | 'punches', format: 'xlsx' | 'csv') {
  const rows = kind === 'muster' ? musterRows(r) : punchRows(r);
  const name = `${kind === 'muster' ? 'muster' : 'punches'}-${r.month}.${format}`;
  return format === 'xlsx'
    ? {
        name,
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        body: toXlsx(kind === 'muster' ? 'Muster' : 'Punches', rows),
      }
    : { name, type: 'text/csv; charset=utf-8', body: toCsv(rows) };
}

const TONE: Record<string, string> = {
  A: '#f6d5d2',
  HD: '#fbe7c6',
  LT: '#fbe7c6',
  WO: '#e8e6e1',
  H: '#e3ecf7',
};

/** The muster as a landscape A3 page set: codes in a grid, totals at the right, a legend underneath. */
export async function musterPdf(r: Muster, appName: string) {
  const dayHead = r.days.map((d) => ({
    text: `${Number(d.date.slice(8))}\n${DAY[d.weekday]}`,
    bold: true,
    alignment: 'center',
    fillColor: d.weekday === 7 ? '#e8e6e1' : '#f2efe7',
  }));
  const totalsHead = ['P', 'LT', 'HD', 'A', 'L', 'WO', 'H', 'Hrs', 'OT'].map((h) => ({
    text: h,
    bold: true,
    alignment: 'center',
    fillColor: '#f2efe7',
  }));
  const body = r.people.map((p) => [
    { text: `${p.name}${p.code ? `\n${p.code}` : ''}`, bold: true },
    ...p.cells.map((c) => ({
      text: c.code,
      alignment: 'center',
      fillColor: TONE[c.code.split('/')[0]!] ?? (c.status === 'ON_LEAVE' ? '#e6f0e4' : undefined),
    })),
    ...[
      p.totals.present,
      p.totals.late,
      p.totals.halfDays,
      p.totals.absent,
      p.totals.leave,
      p.totals.weeklyOffs,
      p.totals.holidays,
      hours(p.totals.workedMin),
      hours(p.totals.overtimeMin),
    ].map((v) => ({ text: String(v), alignment: 'center' })),
  ]);
  return renderPdf({
    pageSize: 'A3',
    pageOrientation: 'landscape',
    pageMargins: [20, 30, 20, 30],
    defaultStyle: { font: 'Helvetica', fontSize: 6.5 },
    info: { title: `Muster ${r.month}`, creator: appName },
    content: [
      { text: `${r.company} · Attendance muster · ${monthName(r.month)}`, fontSize: 14, bold: true },
      { text: `${r.people.length} people`, color: '#666', margin: [0, 2, 0, 8] },
      {
        table: {
          headerRows: 1,
          widths: [92, ...r.days.map(() => '*'), ...totalsHead.map(() => 20)],
          body: [[{ text: 'Person', bold: true, fillColor: '#f2efe7' }, ...dayHead, ...totalsHead], ...body],
        },
        layout: {
          hLineColor: '#dddddd',
          vLineColor: '#dddddd',
          hLineWidth: () => 0.4,
          vLineWidth: () => 0.4,
        },
      },
      {
        text: 'P present · LT late (counts as present) · HD half day · A absent · CL/SL/EL… leave by type (½ = half day) · WO weekly off · H holiday · WO/P, H/P worked on an off day · – no record · blank: before joining or after today. Hrs = hours worked, OT = overtime hours.',
        color: '#666',
        fontSize: 7,
        margin: [0, 8, 0, 0],
      },
    ],
  });
}
