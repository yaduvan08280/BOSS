// Load test: 50 people using MONO at once (Phase 10 performance pass). See deploy/k6/README.md.
//   docker run --rm --network host -v "$PWD/deploy/k6:/k6" grafana/k6:1.4.2 run /k6/load.js
// Settings (env): BASE (default http://localhost:8080 — must match BASE_URL), LOGIN (default owner@demo.mono), PASSWORD (Demo1234), VUS (50).
/* global __ENV, __ITER, __VU */
import http from 'k6/http';
import { check, group, sleep } from 'k6';

const BASE = __ENV.BASE || 'http://localhost:8080';
const LOGIN = __ENV.LOGIN || 'owner@demo.mono';
const PASSWORD = __ENV.PASSWORD || 'Demo1234';
const VUS = Number(__ENV.VUS || 50);

export const options = {
  // Keep each simulated person's session cookie between iterations (k6 clears it by default).
  noCookiesReset: true,
  scenarios: {
    office: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: VUS },
        { duration: '2m', target: VUS },
        { duration: '15s', target: 0 },
      ],
      gracefulRampDown: '10s',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    'http_req_duration{kind:read}': ['p(95)<800'],
    'http_req_duration{kind:write}': ['p(95)<1500'],
    checks: ['rate>0.99'],
  },
};

const json = { headers: { 'Content-Type': 'application/json', Origin: BASE } };
const read = (path) => {
  const r = http.get(`${BASE}${path}`, { tags: { kind: 'read', name: path } });
  check(r, { [`${path} 200`]: (x) => x.status === 200 });
  return r;
};

/** Each simulated person signs in once (their own session cookie), then works through a typical few screens. */
export default function () {
  if (__ITER === 0) {
    const r = http.post(`${BASE}/api/auth/login`, JSON.stringify({ identifier: LOGIN, password: PASSWORD }), {
      ...json,
      tags: { kind: 'write', name: 'login' },
    });
    check(r, { 'signed in': (x) => x.status === 200 });
  }
  group('home', () => {
    read('/api/auth/me');
    read('/api/work/counts');
    read('/api/notifications');
  });
  sleep(1 + Math.random());
  group('delegation', () => {
    read('/api/tasks/tiles');
    read('/api/tasks');
  });
  sleep(1 + Math.random());
  group('checklists and processes', () => {
    read('/api/checklists/masters');
    read('/api/fms/my');
    read('/api/fms/flows');
  });
  sleep(1 + Math.random());
  group('stock and sales', () => {
    read('/api/ims/items');
    read('/api/crm/dashboard');
    read('/api/crm/customers');
    read('/api/crm/calls');
  });
  sleep(1 + Math.random());
  // One in five people also adds something: a delegated task to themselves.
  if (Math.random() < 0.2) {
    group('write', () => {
      const me = read('/api/auth/me').json();
      const due = new Date(Date.now() + 86_400_000).toISOString();
      const r = http.post(
        `${BASE}/api/tasks`,
        JSON.stringify({ doerId: me.user.id, plannedAt: due, description: `Load test task ${__VU}-${__ITER}` }),
        { ...json, tags: { kind: 'write', name: 'create task' } },
      );
      check(r, { 'task created': (x) => x.status === 200 });
    });
  }
  sleep(2 + Math.random() * 2);
}
