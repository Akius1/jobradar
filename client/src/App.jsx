import { useCallback, useEffect, useMemo, useState } from "react";
import JobDetail from "./JobDetail.jsx";
import { VERDICT, timeAgo, roleLabel } from "./shared.js";

// Eligibility is its own filter axis. Relocation sits alongside the three
// verdicts because it cuts across them: a region-locked role that sponsors a
// visa is still reachable.
const ELIGIBILITY = [
  {
    key: "eligible",
    label: "Africa-friendly",
    tone: "jade",
    note: "Explicitly open worldwide, or names an African country",
  },
  {
    key: "maybe",
    label: "Worth a shot",
    tone: "copper",
    note: "Remote, but the geography policy is unstated. Often still open",
  },
  {
    key: "restricted",
    label: "Restricted",
    tone: "crimson",
    note: "Region-locked to a country or timezone you would need to be in",
  },
  {
    key: "relocation",
    label: "Relocation / visa",
    tone: "gold",
    note: "Mentions relocation support or visa sponsorship, whatever the verdict",
  },
];

/** Hash routing: "#/job/<id>" opens the detail screen, empty hash is the list. */
function useRoute() {
  const read = () => decodeURIComponent(window.location.hash.replace(/^#\/job\//, "")) || null;
  const [jobId, setJobId] = useState(() =>
    window.location.hash.startsWith("#/job/") ? read() : null
  );
  useEffect(() => {
    const onChange = () =>
      setJobId(window.location.hash.startsWith("#/job/") ? read() : null);
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return jobId;
}

export default function App() {
  const jobId = useRoute();
  // Filter state lives here so it survives a trip into a role and back.
  const filters = {
    roles: useState([]),
    eligibility: useState(["eligible"]),
    sources: useState([]),
    within: useState("48h"),
    q: useState(""),
  };
  const open = (id) => {
    window.location.hash = `#/job/${encodeURIComponent(id)}`;
  };

  if (jobId) {
    return (
      <JobDetail
        id={jobId}
        onBack={() => {
          window.location.hash = "";
        }}
        onOpen={open}
      />
    );
  }
  return <JobList onOpen={open} filters={filters} />;
}

function JobList({ onOpen, filters }) {
  const [jobs, setJobs] = useState([]);
  const [meta, setMeta] = useState(null);
  const [roles, setRoles] = filters.roles;
  const [eligibility, setEligibility] = filters.eligibility;
  const [sources, setSources] = filters.sources;
  const [within, setWithin] = filters.within;
  const [q, setQ] = filters.q;
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  /** Add or remove one value from a multi-select group. */
  const toggle = (list, setList, key) =>
    setList(list.includes(key) ? list.filter((k) => k !== key) : [...list, key]);

  const load = useCallback(async () => {
    try {
      setError(null);
      const params = new URLSearchParams({ within });
      if (roles.length) params.set("role", roles.join(","));
      if (eligibility.length) params.set("eligibility", eligibility.join(","));
      if (sources.length) params.set("source", sources.join(","));
      if (q.trim()) params.set("q", q.trim());
      const res = await fetch(`/api/jobs?${params}`);
      if (!res.ok) throw new Error(`API error ${res.status}`);
      const data = await res.json();
      setJobs(data.jobs);
      setMeta(data.meta);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [roles, eligibility, sources, within, q]);

  useEffect(() => {
    const t = setTimeout(load, q ? 250 : 0); // debounce typing
    return () => clearTimeout(t);
  }, [load, q]);

  const refresh = async () => {
    setRefreshing(true);
    try {
      await fetch("/api/refresh", { method: "POST" });
      await load();
    } finally {
      setRefreshing(false);
    }
  };

  const sourceNames = useMemo(() => Object.keys(meta?.sources || {}).sort(), [meta]);
  const statuses = Object.values(meta?.sourceStatus || {});
  const liveSources = statuses.filter((s) => s.ok).length;
  const windowLabel =
    meta?.windows?.find((w) => w.key === within)?.label || "48 hours";
  const activeCount = roles.length + eligibility.length + sources.length;

  return (
    <div className="app">
      <header className="hero">
        <div className="hero-bar">
          <div className="wordmark">
            <span className="mark" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="26" height="26" fill="none">
                <circle cx="12" cy="12" r="2.2" fill="currentColor" />
                <circle cx="12" cy="12" r="6" stroke="currentColor" strokeWidth="1.1" opacity=".55" />
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.1" opacity=".25" />
                <path d="M12 12L20.5 6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
              </svg>
            </span>
            <h1>JobRadar</h1>
          </div>
          <button className="refresh" onClick={refresh} disabled={refreshing}>
            <span className={`refresh-dot ${refreshing ? "spinning" : ""}`} />
            {refreshing ? "Sweeping" : "Refresh"}
          </button>
        </div>

        <p className="lede">
          Every software role posted in the last <em>{windowLabel}</em>, swept from
          boards worldwide and graded on one question that job sites never answer:
          <em> can you actually apply from here?</em>
        </p>

        <div className="rail">
          <Stat value={meta?.total ?? "-"} label={`In last ${windowLabel}`} accent />
          <Stat value={meta?.eligibility?.eligible ?? "-"} label="Africa-friendly" />
          <Stat value={meta?.eligibility?.relocation ?? "-"} label="Relocation" />
          <Stat value={meta ? `${liveSources}/${statuses.length}` : "-"} label="Sources live" />
          <Stat value={meta?.lastRefresh ? timeAgo(meta.lastRefresh) : "-"} label="Last sweep" />
        </div>
      </header>

      <section className="console">
        <input
          className="search"
          placeholder="Search role, company, or stack…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />

        <FilterRow label="Posted within">
          {(meta?.windows || []).map((w) => (
            <Chip key={w.key} active={within === w.key} onClick={() => setWithin(w.key)}>
              {w.label}
              <b>{w.count}</b>
            </Chip>
          ))}
        </FilterRow>

        <FilterRow label="Discipline">
          <Chip active={roles.length === 0} onClick={() => setRoles([])}>
            All roles
            <b>{meta?.total ?? 0}</b>
          </Chip>
          {(meta?.roles || []).map((r) => (
            <Chip
              key={r.key}
              active={roles.includes(r.key)}
              onClick={() => toggle(roles, setRoles, r.key)}
            >
              {r.label}
              <b>{r.count}</b>
            </Chip>
          ))}
        </FilterRow>

        <FilterRow label="Eligibility">
          <Chip active={eligibility.length === 0} onClick={() => setEligibility([])}>
            Everywhere
            <b>{meta?.total ?? 0}</b>
          </Chip>
          {ELIGIBILITY.map((e) => (
            <Chip
              key={e.key}
              tone={e.tone}
              title={e.note}
              active={eligibility.includes(e.key)}
              onClick={() => toggle(eligibility, setEligibility, e.key)}
            >
              <i className={`dot dot-${e.tone}`} />
              {e.label}
              <b>{meta?.eligibility?.[e.key] ?? 0}</b>
            </Chip>
          ))}
        </FilterRow>

        {sourceNames.length > 0 && (
          <FilterRow label="Source">
            <Chip active={sources.length === 0} onClick={() => setSources([])}>
              All sources
            </Chip>
            {sourceNames.map((s) => (
              <Chip
                key={s}
                active={sources.includes(s)}
                onClick={() => toggle(sources, setSources, s)}
              >
                {s}
                <b>{meta.sources[s]}</b>
              </Chip>
            ))}
          </FilterRow>
        )}

        {activeCount > 0 && (
          <div className="console-foot">
            <span>
              {jobs.length} {jobs.length === 1 ? "role" : "roles"} matching{" "}
              {activeCount} {activeCount === 1 ? "filter" : "filters"}
            </span>
            <button
              className="clear"
              onClick={() => {
                setRoles([]);
                setEligibility([]);
                setSources([]);
              }}
            >
              Clear all
            </button>
          </div>
        )}
      </section>

      <main className="list">
        {loading && <Empty>Sweeping the radar…</Empty>}
        {error && <Empty>{error}. Is the server running on port 4000?</Empty>}
        {!loading && !error && jobs.length === 0 && (
          <Empty>
            Nothing matches these filters. Widen the time window, or add{" "}
            <em>Worth a shot</em> to your eligibility picks.
          </Empty>
        )}

        {jobs.map((job) => {
          const v = VERDICT[job.eligibility];
          return (
            <button
              className={`card tone-${v.tone}`}
              key={job.id}
              onClick={() => onOpen(job.id)}
            >
              <div className="card-body">
                <div className="card-head">
                  <h2>{job.title}</h2>
                  <span className="age">{timeAgo(job.postedAt)} ago</span>
                </div>

                <p className="meta-line">
                  <span className="company">{job.company}</span>
                  <span className="sep">·</span>
                  <span>{job.locationText}</span>
                  {job.salary && (
                    <>
                      <span className="sep">·</span>
                      <span className="salary">{job.salary}</span>
                    </>
                  )}
                </p>

                <div className="badges">
                  <span className={`verdict verdict-${v.tone}`}>
                    <i className={`dot dot-${v.tone}`} />
                    {v.label}
                  </span>
                  <span className="pill">{roleLabel(job.role)}</span>
                  <span className="pill pill-ghost">{job.source}</span>
                  {job.relocation && (
                    <span className="pill pill-visa">relocation / visa</span>
                  )}
                </div>

                {job.tags?.length > 0 && (
                  <div className="tags">
                    {job.tags.map((t) => (
                      <span key={t}>{t}</span>
                    ))}
                  </div>
                )}
              </div>
              <span className="cta">View role →</span>
            </button>
          );
        })}
      </main>

      <footer className="foot">
        <span>
          Remotive · RemoteOK · Arbeitnow · Himalayas · WeWorkRemotely · Jobicy
          {meta?.jsearchEnabled && " · JSearch"}
        </span>
        {meta?.retained > 0 && (
          <span className="foot-hint">{meta.retained} roles retained over the past month</span>
        )}
        {meta && !meta.jsearchEnabled && (
          <span className="foot-hint">
            Set <code>RAPIDAPI_KEY</code> to pull LinkedIn, Indeed and Glassdoor too.
          </span>
        )}
      </footer>
    </div>
  );
}

function Stat({ value, label, accent }) {
  return (
    <div className="stat">
      <span className={`stat-value ${accent ? "stat-accent" : ""}`}>{value}</span>
      <span className="stat-label">{label}</span>
    </div>
  );
}

function FilterRow({ label, children }) {
  return (
    <div className="frow">
      <span className="frow-label">{label}</span>
      <div className="frow-chips">{children}</div>
    </div>
  );
}

function Chip({ active, tone = "neutral", children, ...rest }) {
  return (
    <button className={`chip ${active ? `chip-on chip-${tone}` : ""}`} {...rest}>
      {children}
    </button>
  );
}

function Empty({ children }) {
  return <p className="empty">{children}</p>;
}
