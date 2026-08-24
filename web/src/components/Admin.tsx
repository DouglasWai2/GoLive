import { type FormEvent, type ReactNode, useEffect, useState } from "react";
import { Brand } from "./Brand";
import {
  AdminApiError,
  type AdminOverview,
  type TurnUsageResult,
  adminLogin,
  getAdminOverview,
  getTurnUsage,
} from "../services/adminApi";

const ADMIN_TOKEN_KEY = "golive.adminToken";

function loadAdminToken() {
  try {
    return sessionStorage.getItem(ADMIN_TOKEN_KEY);
  } catch {
    return null;
  }
}

function storeAdminToken(token: string) {
  try {
    sessionStorage.setItem(ADMIN_TOKEN_KEY, token);
  } catch {
    // The authenticated view still works when storage is unavailable.
  }
}

function clearAdminToken() {
  try {
    sessionStorage.removeItem(ADMIN_TOKEN_KEY);
  } catch {
    // Nothing else needs to be cleared when storage is unavailable.
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "The admin request failed.";
}

function isUnauthorized(error: unknown) {
  return error instanceof AdminApiError && error.status === 401;
}

function currentUtcMonth() {
  const now = new Date();
  const to = now.toISOString().slice(0, 10);
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
    .toISOString()
    .slice(0, 10);

  return { from, to };
}

const dateTime = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "medium",
});

function formatBytes(value: number) {
  if (!Number.isFinite(value)) return "Unavailable";

  const units = ["B", "KB", "MB", "GB", "TB"];
  const unitIndex = value > 0
    ? Math.min(Math.floor(Math.log(value) / Math.log(1000)), units.length - 1)
    : 0;
  const amount = value / (1000 ** unitIndex);

  return `${amount.toLocaleString(undefined, { maximumFractionDigits: 1 })} ${units[unitIndex]}`;
}

function formatPercent(value: number) {
  if (!Number.isFinite(value)) return "Unavailable";
  return `${value.toFixed(1)}%`;
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unavailable" : dateTime.format(date);
}

function formatDuration(totalSeconds: number) {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return "Unavailable";
  const seconds = Math.floor(totalSeconds);
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);

  if (days) return `${days}d ${hours}h`;
  if (hours) return `${hours}h ${minutes}m`;
  if (minutes) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

function loginErrorMessage(error: unknown) {
  if (error instanceof AdminApiError && error.status === 401) {
    return "That shared secret was not accepted.";
  }
  return errorMessage(error);
}

function AdminLogin({ onLogin }: { onLogin: (token: string) => void }) {
  const [secret, setSecret] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (submitting || !secret) return;

    setSubmitting(true);
    setError("");
    try {
      const token = await adminLogin(secret);
      setSecret("");
      onLogin(token);
    } catch (requestError) {
      setSecret("");
      setError(loginErrorMessage(requestError));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="admin-shell admin-login-shell">
      <header className="admin-login-header">
        <Brand ariaLabel="GoLive home" />
        <span>Operations console</span>
      </header>
      <section className="admin-login-card" aria-labelledby="admin-login-title">
        <p className="admin-kicker"><span /> Restricted access</p>
        <h1 id="admin-login-title">Server admin</h1>
        <p className="admin-login-copy">
          Enter the shared admin secret. It is exchanged once and is never stored
          in this browser.
        </p>
        <form onSubmit={submit}>
          <label htmlFor="admin-secret">Shared secret</label>
          <input
            id="admin-secret"
            type="password"
            autoComplete="off"
            value={secret}
            onChange={(event) => setSecret(event.target.value)}
            autoFocus
            required
          />
          {error && <p className="admin-form-error" role="alert">{error}</p>}
          <button className="admin-primary-button" type="submit" disabled={submitting || !secret}>
            {submitting ? "Authenticating..." : "Open console"}
          </button>
        </form>
      </section>
    </main>
  );
}

type DashboardProps = {
  token: string;
  onLogout: () => void;
};

function AdminDashboard({ token, onLogout }: DashboardProps) {
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [overviewError, setOverviewError] = useState("");
  const [overviewRefresh, setOverviewRefresh] = useState(0);
  const [overviewRefreshing, setOverviewRefreshing] = useState(true);
  const [overviewUpdatedAt, setOverviewUpdatedAt] = useState<Date | null>(null);
  const [turn, setTurn] = useState<TurnUsageResult | null>(null);
  const [turnError, setTurnError] = useState("");
  const [turnRefresh, setTurnRefresh] = useState(0);
  const [turnRefreshing, setTurnRefreshing] = useState(true);
  const [turnUpdatedAt, setTurnUpdatedAt] = useState<Date | null>(null);
  const [turnRange] = useState(currentUtcMonth);

  useEffect(() => {
    const controller = new AbortController();
    let pending = false;

    const fetchOverview = async () => {
      if (pending) return;
      pending = true;
      setOverviewRefreshing(true);
      try {
        const result = await getAdminOverview(token, controller.signal);
        setOverview(result);
        setOverviewError("");
        const generatedAt = new Date(result.generatedAt);
        setOverviewUpdatedAt(Number.isNaN(generatedAt.getTime()) ? new Date() : generatedAt);
      } catch (error) {
        if (controller.signal.aborted) return;
        if (isUnauthorized(error)) {
          onLogout();
          return;
        }
        setOverviewError(errorMessage(error));
      } finally {
        pending = false;
        if (!controller.signal.aborted) setOverviewRefreshing(false);
      }
    };

    void fetchOverview();
    const timer = window.setInterval(() => void fetchOverview(), 10_000);

    return () => {
      window.clearInterval(timer);
      controller.abort();
    };
  }, [token, overviewRefresh]);

  useEffect(() => {
    const controller = new AbortController();

    const fetchUsage = async () => {
      setTurnRefreshing(true);
      try {
        const result = await getTurnUsage(
          token,
          turnRange.from,
          turnRange.to,
          controller.signal,
        );
        setTurn(result);
        setTurnError("");
        setTurnUpdatedAt(new Date());
      } catch (error) {
        if (controller.signal.aborted) return;
        if (isUnauthorized(error)) {
          onLogout();
          return;
        }
        setTurnError(errorMessage(error));
      } finally {
        if (!controller.signal.aborted) setTurnRefreshing(false);
      }
    };

    void fetchUsage();
    return () => controller.abort();
  }, [token, turnRange, turnRefresh]);

  const refresh = () => {
    if (overviewRefreshing || turnRefreshing) return;
    setOverviewRefreshing(true);
    setTurnRefreshing(true);
    setOverviewRefresh((value) => value + 1);
    setTurnRefresh((value) => value + 1);
  };

  const participants = overview?.rooms.flatMap((room) =>
    room.participants.map((participant) => ({ ...participant, roomId: room.id }))) ?? [];
  const busy = overviewRefreshing || turnRefreshing;
  const lastUpdatedAt = overviewUpdatedAt && turnUpdatedAt
    ? new Date(Math.max(overviewUpdatedAt.getTime(), turnUpdatedAt.getTime()))
    : overviewUpdatedAt ?? turnUpdatedAt;

  return (
    <main className="admin-shell admin-dashboard">
      <header className="admin-header">
        <div className="admin-header-brand">
          <Brand ariaLabel="GoLive home" />
          <span>Admin</span>
        </div>
        <div className="admin-header-actions">
          <div className="admin-updated" aria-live="polite">
            <span>Last updated</span>
            <strong>{lastUpdatedAt ? dateTime.format(lastUpdatedAt) : "Waiting for data"}</strong>
          </div>
          <button className="admin-action-button" type="button" onClick={refresh} disabled={busy}>
            {busy ? "Refreshing..." : "Refresh now"}
          </button>
          <button className="admin-logout-button" type="button" onClick={onLogout}>Logout</button>
        </div>
      </header>

      <div className="admin-content">
        <section className="admin-title-row" aria-labelledby="admin-title">
          <div>
            <p className="admin-kicker"><span /> Operations overview</p>
            <h1 id="admin-title">Live infrastructure</h1>
          </div>
          <div className="admin-scope-notice">
            <span aria-hidden="true" />
            <div><strong>Live / single server process</strong><small>In-memory state for this instance only</small></div>
          </div>
        </section>

        {overviewError && (
          <div className="admin-alert" role="alert">
            <strong>Overview unavailable</strong><span>{overviewError}</span>
          </div>
        )}

        {!overview && overviewRefreshing ? (
          <section className="admin-loading" aria-live="polite">Loading live server state...</section>
        ) : overview ? (
          <>
            <section className="admin-summary-grid" aria-label="Live summary">
              <article className="admin-summary-card">
                <span>Active rooms</span><strong>{overview.summary.activeRooms}</strong><small>in this process</small>
              </article>
              <article className="admin-summary-card">
                <span>Connected users</span><strong>{overview.summary.activeUsers}</strong><small>across all rooms</small>
              </article>
              <article className="admin-summary-card admin-summary-acid">
                <span>Active sharers</span><strong>{overview.summary.activeSharers}</strong><small>sending screens now</small>
              </article>
              <article className="admin-summary-card">
                <span>Server uptime</span><strong>{formatDuration(overview.system.process.uptimeSeconds)}</strong><small>since {formatDate(overview.serverStartedAt)}</small>
              </article>
            </section>

            <section className="admin-resource-grid" aria-label="Server resources">
              <ResourcePanel title="Process" eyebrow="Node runtime">
                <Metric label="CPU" value={formatPercent(overview.system.process.cpuPercent)} />
                <Metric label="Resident memory" value={formatBytes(overview.system.process.rssBytes)} />
                <Metric label="Heap used" value={formatBytes(overview.system.process.heapUsedBytes)} detail={`of ${formatBytes(overview.system.process.heapTotalBytes)}`} />
                <Metric label="External memory" value={formatBytes(overview.system.process.externalBytes)} />
              </ResourcePanel>
              <ResourcePanel title={overview.system.host.hostname} eyebrow={`${overview.system.host.platform} host`}>
                <Metric label="CPU" value={formatPercent(overview.system.host.cpuPercent)} detail={`${overview.system.host.cpuCount} logical cores`} />
                <Metric label="Memory used" value={formatBytes(overview.system.host.totalMemoryBytes - overview.system.host.freeMemoryBytes)} detail={`${formatBytes(overview.system.host.freeMemoryBytes)} free`} />
                <Metric label="Load average" value={overview.system.host.loadAverage.map((load) => load.toFixed(2)).join(" / ") || "Unavailable"} detail="1 / 5 / 15 min" />
              </ResourcePanel>
              <ResourcePanel title="Disk" eyebrow={overview.system.disk?.path ?? "Storage telemetry"}>
                {overview.system.disk ? (
                  <>
                    <Metric label="Used" value={formatBytes(overview.system.disk.usedBytes)} detail={`of ${formatBytes(overview.system.disk.totalBytes)}`} />
                    <Metric label="Free" value={formatBytes(overview.system.disk.freeBytes)} />
                    <progress
                      className="admin-resource-progress"
                      aria-label="Disk space used"
                      max={overview.system.disk.totalBytes}
                      value={overview.system.disk.usedBytes}
                    />
                  </>
                ) : <p className="admin-unavailable">Disk telemetry is unavailable.</p>}
              </ResourcePanel>
            </section>
          </>
        ) : (
          <section className="admin-empty-state">No overview data is available.</section>
        )}

        <TurnPanel
          result={turn}
          error={turnError}
          loading={turnRefreshing && !turn}
          updatedAt={turnUpdatedAt}
          range={turnRange}
        />

        {overview && (
          <>
            <DataSection title="Active rooms" count={overview.rooms.length}>
              {overview.rooms.length ? (
                <div className="admin-table-scroll">
                  <table className="admin-table">
                    <thead><tr><th>Room</th><th>Started</th><th>Age</th><th>Users</th><th>Sharers</th></tr></thead>
                    <tbody>{overview.rooms.map((room) => (
                      <tr key={room.id}>
                        <td><code>{room.id}</code></td>
                        <td>{formatDate(room.startedAt)}</td>
                        <td>{formatDuration((Date.now() - new Date(room.startedAt).getTime()) / 1_000)}</td>
                        <td>{room.activeUsers}</td>
                        <td><span className={room.activeSharers ? "admin-live-value" : undefined}>{room.activeSharers}</span></td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              ) : <p className="admin-empty-state">No rooms are active.</p>}
            </DataSection>

            <DataSection title="Active users" count={participants.length}>
              {participants.length ? (
                <div className="admin-table-scroll">
                  <table className="admin-table">
                    <thead><tr><th>Name</th><th>Participant</th><th>Room</th><th>Connected</th><th>Sharing</th></tr></thead>
                    <tbody>{participants.map((participant) => (
                      <tr key={`${participant.roomId}:${participant.id}`}>
                        <td><strong>{participant.name}</strong></td>
                        <td><code>{participant.id}</code></td>
                        <td><code>{participant.roomId}</code></td>
                        <td>{formatDate(participant.connectedAt)}</td>
                        <td><span className={`admin-status ${participant.sharing ? "admin-status-live" : ""}`}>{participant.sharing ? "Sharing" : "Viewing"}</span></td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              ) : <p className="admin-empty-state">No users are connected.</p>}
            </DataSection>
          </>
        )}
      </div>
    </main>
  );
}

function Metric({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return <div className="admin-metric"><span>{label}</span><strong>{value}</strong>{detail && <small>{detail}</small>}</div>;
}

function ResourcePanel({ title, eyebrow, children }: { title: string; eyebrow: string; children: ReactNode }) {
  return <article className="admin-resource-panel"><p>{eyebrow}</p><h2>{title}</h2><div className="admin-metrics">{children}</div></article>;
}

function DataSection({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  return <section className="admin-data-section"><header><h2>{title}</h2><span>{count.toLocaleString()} total</span></header>{children}</section>;
}

type TurnPanelProps = {
  result: TurnUsageResult | null;
  error: string;
  loading: boolean;
  updatedAt: Date | null;
  range: { from: string; to: string };
};

function TurnPanel({ result, error, loading, updatedAt, range }: TurnPanelProps) {
  const used = result?.usage.freeTierPercent ?? 0;
  const remaining = Math.max(0, 100 - used);

  return (
    <section className="admin-turn-panel" aria-labelledby="admin-turn-title">
      <header>
        <div><p>Cloudflare TURN</p><h2 id="admin-turn-title">Relay usage</h2></div>
        <div className="admin-turn-meta">
          {result?.stale && <span className="admin-stale-badge">Stale data</span>}
          <span>{range.from} to {range.to}</span>
          <small>{updatedAt ? `Checked ${dateTime.format(updatedAt)}` : "Not checked yet"}</small>
        </div>
      </header>
      {error && <div className="admin-inline-error" role="alert">TURN usage unavailable: {error}</div>}
      {loading ? <p className="admin-unavailable">Loading relay usage...</p> : result ? (
        <div className="admin-turn-grid">
          <div className="admin-turn-stat"><span>Egress</span><strong>{formatBytes(result.usage.egressBytes)}</strong><small>{result.usage.egressGB.toFixed(3)} GB</small></div>
          <div className="admin-turn-stat"><span>Ingress</span><strong>{formatBytes(result.usage.ingressBytes)}</strong><small>{result.usage.ingressGB.toFixed(3)} GB</small></div>
          <div className="admin-allowance">
            <div><span>Free allowance remaining</span><strong>{formatPercent(remaining)}</strong></div>
            <progress aria-label="Cloudflare TURN free tier used" max="100" value={Math.min(100, Math.max(0, used))} />
            <small>{formatPercent(used)} of the monthly free tier used{result.fetchedAt ? ` | Source fetched ${formatDate(result.fetchedAt)}` : ""}</small>
          </div>
        </div>
      ) : <p className="admin-unavailable">Cloudflare TURN usage is unavailable.</p>}
    </section>
  );
}

export function Admin() {
  const [token, setToken] = useState(loadAdminToken);

  const login = (nextToken: string) => {
    storeAdminToken(nextToken);
    setToken(nextToken);
  };

  const logout = () => {
    clearAdminToken();
    setToken(null);
  };

  return token
    ? <AdminDashboard token={token} onLogout={logout} />
    : <AdminLogin onLogin={login} />;
}
