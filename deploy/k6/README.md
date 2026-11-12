# Load test (k6)

`load.js` simulates **50 people** working at the same time for 2½ minutes: each signs in once, then goes through
Home, Delegation, Checklists / processes, Stock and Sales screens with 1–2 s pauses, and one in five also creates a
task. It fails if more than 1% of requests fail or the 95th percentile is over 800 ms (reads) / 1500 ms (writes).

Run it against the Docker stack with the demo company loaded (not on the live server during work hours):

```bash
./deploy/compose.sh run --rm migrate node apps/api/dist/seed-demo.js     # once: the demo company
# The per-IP total of the API ceiling and the login limit could stop 50 people coming from one test machine:
#   in .env for the test only: API_RATE_LIMIT=0 and LOGIN_RATE_LIMIT=1000, then ./deploy/compose.sh up -d
docker run --rm --network host -v "$PWD/deploy/k6:/k6" grafana/k6:1.4.2 run /k6/load.js
```

`BASE` must be the same address as `BASE_URL` in `.env` (the origin check refuses sign-ins from another address).

Options: `-e VUS=100`, `-e BASE=http://localhost:8080`, `-e LOGIN=owner@demo.mono -e PASSWORD=Demo1234`.

## Results

| Date | Machine | VUs | Requests | Failed | p95 read | p95 write | Notes |
|---|---|---|---|---|---|---|---|
| 05/11/2026 | dev PC (WSL2, i7), Docker stack, demo company | 50 | 9,972 in 3 min (52/s) | 0% | 23 ms (avg 12 ms) | 41 ms | 799 iterations; one slowest request 2.8 s while the stack warmed up |
