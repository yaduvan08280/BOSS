import { gstinCheck, signIn } from './client.mjs';
import { BRANCHES, DEPARTMENTS, DESIGNATIONS, HEADS, LOCATIONS, MANAGERS, PEOPLE, SHIFTS } from './data-org.mjs';

const same = (a, b) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();
const list = (x, key) => (Array.isArray(x) ? x : (x?.[key] ?? []));

/** Company profile: only what is still empty is filled, so real details are never overwritten. */
export async function company(ctx) {
  const { api } = ctx;
  const now = (await api.get('/api/org/company')).profile;
  const madeUp = `08AAKCT4821M1Z`;
  const body = {
    name: now.name || 'Tora Skylounge',
    city: now.city || 'Jaipur',
    state: now.state || 'Rajasthan',
    ownerName: now.ownerName || ctx.me.user.name,
    mobile: now.mobile || ctx.me.user.mobile || '+918000000000',
    email: now.email || '',
    website: now.website || null,
    cin: now.cin || null,
    gstin: now.gstin || madeUp + gstinCheck(madeUp),
    legalName: now.legalName || 'Tora Hospitality Private Limited',
    pan: now.pan || 'AAKCT4821M',
  };
  await api.put('/api/org/company', body);
  ctx.gstinMadeUp = !now.gstin;
  return ctx.gstinMadeUp ? 'GSTIN is a made-up placeholder — replace it' : 'kept your details';
}

export async function structure(ctx) {
  const { api, ids } = ctx;
  // Branches
  const have = list(await api.get('/api/org/branches'), 'branches');
  for (const b of BRANCHES) {
    let row = have.find((x) => same(x.name, b.name) || same(x.code, b.code));
    const body = {
      name: b.name, code: b.code, type: b.type, city: b.city, state: 'Rajasthan',
      details: { address: b.address, seriesCode: b.code },
    };
    if (!row) row = await api.post('/api/org/branches', body);
    ids.branches[b.key] = row.id ?? row.branch?.id;
  }
  // Stock locations
  const st = await api.get('/api/branches/structure');
  const locs = st.locations ?? [];
  for (const [bk, name, kind] of LOCATIONS) {
    const branchId = ids.branches[bk];
    const row =
      locs.find((l) => l.branchId === branchId && same(l.name, name)) ??
      (await api.post('/api/branches/locations', { name, branchId, kind }));
    ids.locations[name] = row.id;
  }
  // Departments, designations, shifts
  const depts = list(await api.get('/api/org/departments'), 'departments');
  for (const name of DEPARTMENTS) {
    const row = depts.find((d) => same(d.name, name)) ?? (await api.post('/api/org/departments', { name }));
    ids.depts[name] = row.id;
  }
  const des = list(await api.get('/api/org/designations'), 'designations');
  for (const name of DESIGNATIONS) {
    const row = des.find((d) => same(d.name, name)) ?? (await api.post('/api/org/designations', { name }));
    ids.desigs[name] = row.id;
  }
  const shifts = list(await api.get('/api/org/shifts'), 'shifts');
  for (const [name, start, end, weekdays] of SHIFTS) {
    const row = shifts.find((s) => same(s.name, name)) ?? (await api.post('/api/org/shifts', { name, start, end, weekdays }));
    ids.shifts[name] = row.id;
  }
  return `${BRANCHES.length} branches, ${LOCATIONS.length} stock locations, ${DEPARTMENTS.length} departments, ${SHIFTS.length} shifts`;
}

export async function people(ctx) {
  const { api, ids } = ctx;
  const roles = list(await api.get('/api/org/roles'), 'roles');
  const role = (key) => roles.find((r) => r.key === key)?.id;
  let users = list(await api.get('/api/org/users'), 'users');
  let made = 0;
  for (const [i, p] of PEOPLE.entries()) {
    const [key, name, roleKey, desig, dept, branch, shift, , salary] = p;
    const mobile = `90000${String(10100 + i)}`;
    let row = users.find((u) => same(u.name, name));
    if (!row) {
      const res = await api.post('/api/org/users', {
        name, mobile, roleId: role(roleKey), designationId: ids.desigs[desig], mainDepartmentId: ids.depts[dept],
        branchId: ids.branches[branch], shiftId: ids.shifts[shift], loginEnabled: true,
      });
      row = res.person;
      made += 1;
      // The one-time password is swapped for the demo password by signing in once as the person.
      if (res.tempPassword) {
        const first = await signIn(ctx.base, mobile, res.tempPassword, ctx.me.company.id);
        await first.post('/api/auth/change-password', { currentPassword: res.tempPassword, newPassword: ctx.staffPassword });
      }
      await api.patch(`/api/org/users/${row.id}`, { hr: { salary, doj: '2025-04-01' } }).catch(() => {});
    }
    ids.people[key] = { id: row.id, name, mobile: row.mobile ?? mobile, branch };
  }
  ids.people.owner = { id: ctx.me.user.id, name: ctx.me.user.name, branch: 'ho' };
  // Reporting lines, heads of department, branch managers.
  for (const [key, , , , , , , boss] of PEOPLE)
    await api.patch(`/api/org/users/${ids.people[key].id}`, { reportsToId: ids.people[boss ?? 'owner'].id });
  for (const [dept, key] of Object.entries(HEADS))
    await api.patch(`/api/org/departments/${ids.depts[dept]}`, { hodUserId: ids.people[key].id });
  for (const [bk, keys] of Object.entries(MANAGERS))
    await api.put('/api/branches/managers', { branchId: ids.branches[bk], role: 'MANAGER', userIds: keys.map((k) => ids.people[k].id) });
  for (const bk of Object.keys(MANAGERS))
    await api.put('/api/branches/managers', { branchId: ids.branches[bk], role: 'HR', userIds: [ids.people.kavita.id] });
  users = list(await api.get('/api/org/users'), 'users');
  return `${made} people added (${users.length} in all); staff sign in with their mobile and the staff password`;
}
