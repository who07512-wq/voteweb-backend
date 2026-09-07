# CampusVote Monitoring (Prometheus + Grafana)

The CampusVote backend exposes Prometheus-compatible metrics on **GET `/metrics`**
and an aggregate admin summary on **GET `/api/v1/admin/monitoring`** (admin-only,
used by the `/admin/monitoring` page).

## Metrics

The metrics are **aggregate-only**. No student names, emails, roll numbers, IPs,
session/OAuth/JWT identifiers, candidate selections or voter identities are ever
exported.

| Metric | Type | Meaning |
| --- | --- | --- |
| `campusvote_http_requests_total` | counter | Requests handled, labelled by `method`, `route` (normalized, e.g. `:id`) and `status_code` |
| `campusvote_http_request_duration_seconds` | histogram | Request duration buckets |
| `campusvote_http_requests_active` | gauge | In-flight requests |
| `campusvote_http_errors_total` | counter | 5xx responses |
| `campusvote_votes_cast_total` | counter | Successfully cast votes (incremented only after the vote INSERT succeeds) |
| `campusvote_login_attempts_total` | counter | Login attempts |
| `campusvote_failed_login_attempts_total` | counter | Failed logins |
| `campusvote_active_elections` | gauge | Elections with status `OPEN` |
| `campusvote_registered_students_total` | gauge | Student accounts |
| `campusvote_candidate_applications_total` | gauge | Candidate applications |
| `campusvote_database_connections_total` / `_idle` / `_waiting` | gauge | pg pool stats (reuses the app's existing pool) |
| Standard Node collectors | various | `process_cpu_*`, `nodejs_heap_*`, `nodejs_eventloop_*`, `process_resident_memory_bytes`, etc. |

Vote/login counters are guarded — a monitoring failure can never fail the
underlying vote or login request.

## Protecting /metrics

The scrape endpoint requires `Authorization: Bearer <token>`:

- Set **`METRICS_TOKEN`** on the backend (min 16 chars) to enable scraping.
  Comparison is timing-safe.
- If `METRICS_TOKEN` is **not** set on the server:
  - **Production** → `/metrics` returns **403** (deliberately disabled).
  - Non-production → open access (local dev convenience only).

Direct traffic to `/metrics` (e.g. from DigiCert/Render's edge) counts as a normal
request but is never measured itself; it is excluded from loops.

## Alerting / SLO defaults

Intended Prometheus expressions (deliverables include dashboard + datasource only):

- Error budget: `sum(rate(campusvote_http_errors_total[5m])) / clamp_min(sum(rate(campusvote_http_requests_total[5m])), 1e-9)`
- Uptime probe: `campusvote_http_requests_total` stop appearing (or the scrape target down).

## Files

```
monitoring/
├── prometheus.yml                          # scrape config (bearer token via credentials_file)
└── grafana/
    ├── datasources/datasource.yml          # provisions the Prometheus datasource
    ├── dashboards/dashboards.yml           # provisions dashboard-defs/
    └── dashboard-defs/campusvote-overview.json
```

## Running the stack (local)

```bash
# Make the scrape token available to Prometheus
echo "$METRICS_TOKEN" > monitoring/metrics-token && chmod 600 monitoring/metrics-token

docker run -d --name campusvote-prometheus -p 9090:9090 \
  -v "$PWD/monitoring/prometheus.yml:/etc/prometheus/prometheus.yml:ro" \
  -v "$PWD/monitoring/metrics-token:/run/secrets/campusvote-metrics-token:ro" \
  prom/prometheus:latest

docker run -d --name campusvote-grafana -p 3000:3000 \
  -e GF_SECURITY_ADMIN_PASSWORD=admin \
  -v "$PWD/monitoring/grafana/datasources:/etc/grafana/provisioning/datasources:ro" \
  -v "$PWD/monitoring/grafana/dashboards:/etc/grafana/provisioning/dashboards:ro" \
  -v "$PWD/monitoring/grafana/dashboard-defs:/var/lib/grafana/dashboards:ro" \
  grafana/grafana:latest
```

Open `http://localhost:3000`, sign in, and the **CampusVote System Overview**
dashboard loads automatically from the default Prometheus datasource.

## Render / Vercel hosting notes

- **Render** hosts a long-running process, so `/metrics` (and thus a Prometheus
  scrape) works there. Set `METRICS_TOKEN` on the service and deploy Prometheus
  on a small VM/container that can reach `voteweb-backend-api.onrender.com`.
- **Vercel** (the frontend) is serverless — run nothing scraping there. The
  frontend renders the admin summary page from the backend API instead.
- The Grafana dashboard can be embedded iframe-style later, but it is **not**
  embedded by default (auth/security); the `/admin/monitoring` page is the
  in-app surface.