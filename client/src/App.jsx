import { useCallback, useEffect, useMemo, useState } from "react";
import JobDetail from "./JobDetail.jsx";
import Auth from "./Auth.jsx";
import { authConfigured, getSession, onAuthChange } from "./supabase.js";
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

/**
 * Session state, shared by the list and the detail screen.
 *
 * Held once at the top rather than fetched per screen: the OAuth redirect
 * lands back on whichever route the user left from, and two components racing
 * to read the same session produced a visible flash of the signed-out state.
 */
function useSession() {
  const [session, setSession] = useState(null);
  const [checked, setChecked] = useState(!authConfigured);

  useEffect(() => {
    if (!authConfigured) return;
    let alive = true;
    getSession().then((s) => {
      if (!alive) return;
      setSession(s);
      setChecked(true);
    });
    const off = onAuthChange((s) => alive && setSession(s));
    return () => {
      alive = false;
      off();
    };
  }, []);

  return { session, checked };
}

export default function App() {
  const jobId = useRoute();
  const { session, checked } = useSession();

  // The role someone tried to open before signing in. Kept so they land back
  // on it afterwards instead of on an empty board, which is the most annoying
  // possible outcome of being asked to sign in.
  const [gateFor, setGateFor] = useState(null);
  // Filter state lives here so it survives a trip into a role and back.
  const filters = {
    roles: useState([]),
    eligibility: useState(["eligible"]),
    sources: useState([]),
    within: useState("48h"),
    q: useState(""),
  };
  const go = (id) => {
    window.location.hash = `#/job/${encodeURIComponent(id)}`;
  };

  /**
   * Opening a role is where the gate sits, not the front door. The list stays
   * readable by anyone; signing in is asked for at the point we would start
   * holding a resume, which is the first moment it buys the user anything.
   */
  const open = (id, title) => {
    if (authConfigured && checked && !session) {
      setGateFor({ id, title });
      return;
    }
    go(id);
  };

  const screen = jobId ? (
    <JobDetail
      id={jobId}
      session={session}
      onBack={() => {
        window.location.hash = "";
      }}
      onOpen={open}
    />
  ) : (
    <JobList onOpen={open} filters={filters} session={session} />
  );

  return (
    <>
      {screen}
      {gateFor && (
        <Auth
          jobTitle={gateFor.title}
          onClose={() => setGateFor(null)}
          onSignedIn={() => {
            const { id } = gateFor;
            setGateFor(null);
            go(id);
          }}
        />
      )}
    </>
  );
}

function JobList({ onOpen, filters }) {
  const [jobs, setJobs] = useState([]);
  const [meta, setMeta] = useState(null);
  const [roles, setRoles] = filters.roles;
  const [eligibility, setEligibility] = filters.eligibility;
  const [sources, setSources] = filters.sources;
  const [within, setWithin] = filters.within;
  const [q, setQ] = filters.q;
  // `pending` is any fetch in flight, including the quick ones after a chip
  // toggle, where tearing the console down and rebuilding it would be far more
  // disruptive than leaving the old results up for a moment. The first paint is
  // a separate question, and it is answered by whether meta exists rather than
  // by a flag, so the two cannot drift apart.
  const [pending, setPending] = useState(true);
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
      // The list is keyed on id, and React drops or doubles rows when two
      // children share a key. The sweep collapses duplicate ids now, but data
      // already published carries some, so guard here too.
      const seen = new Set();
      setJobs(
        data.jobs.filter((j) => (seen.has(j.id) ? false : seen.add(j.id)))
      );
      setMeta(data.meta);
    } catch (err) {
      setError(err.message);
    } finally {
      setPending(false);
    }
  }, [roles, eligibility, sources, within, q]);

  useEffect(() => {
    // Marked pending here rather than inside load(), so a chip lights up the
    // progress bar the moment it is clicked instead of after the debounce.
    setPending(true);
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

  // The API only reports facets that have something in the current window. A
  // selection that ages out would otherwise lose its chip while still filtering,
  // leaving an empty list and no visible way to undo it. So anything selected
  // stays on screen, at zero, until you turn it off yourself.
  const roleChips = useMemo(() => {
    const shown = meta?.roles || [];
    const missing = roles.filter((key) => !shown.some((r) => r.key === key));
    return [...shown, ...missing.map((key) => ({ key, label: roleLabel(key), count: 0 }))];
  }, [meta, roles]);

  const sourceChips = useMemo(() => {
    const counts = meta?.sources || {};
    return [...new Set([...Object.keys(counts), ...sources])]
      .sort()
      .map((key) => ({ key, count: counts[key] || 0 }));
  }, [meta, sources]);

  const statuses = Object.values(meta?.sourceStatus || {});
  const liveSources = statuses.filter((s) => s.ok).length;
  const windowLabel =
    meta?.windows?.find((w) => w.key === within)?.label || "48 hours";
  const activeCount =
    roles.length + eligibility.length + sources.length + (q.trim() ? 1 : 0);

  // Keyed on whether the data exists, not on whether a request is running. A
  // failed first load ends with loading false and meta still null, and reading
  // meta.windows there would take the whole page down; shimmering forever at a
  // request that already came back is just as wrong.
  const ready = Boolean(meta);
  const showSkeleton = !ready && !error;

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

        <div className="rail" aria-busy={showSkeleton}>
          <Stat value={meta?.total ?? "-"} label={`In last ${windowLabel}`} accent loading={showSkeleton} />
          <Stat value={meta?.eligibility?.eligible ?? "-"} label="Africa-friendly" loading={showSkeleton} />
          <Stat value={meta?.eligibility?.relocation ?? "-"} label="Relocation" loading={showSkeleton} />
          <Stat value={ready ? `${liveSources}/${statuses.length}` : "-"} label="Sources live" loading={showSkeleton} />
          <Stat
            value={meta?.lastRefresh ? timeAgo(meta.lastRefresh) : "-"}
            label="Last sweep"
            loading={showSkeleton}
          />
        </div>
      </header>

      <section className="console" aria-busy={pending}>
        {pending && ready && <div className="console-progress" aria-hidden="true" />}

        <input
          className="search"
          placeholder="Search role, company, or stack…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />

        <FilterRow label="Posted within">
          {ready ? (
            meta.windows.map((w) => (
              <Chip key={w.key} active={within === w.key} onClick={() => setWithin(w.key)}>
                {w.label}
                <b>{w.count}</b>
              </Chip>
            ))
          ) : showSkeleton ? (
            <ChipSkeletons widths={SK_CHIPS.windows} />
          ) : null}
        </FilterRow>

        <FilterRow label="Discipline">
          {ready ? (
            <>
              <Chip active={roles.length === 0} onClick={() => setRoles([])}>
                All roles
                <b>{meta.total}</b>
              </Chip>
              {roleChips.map((r) => (
                <Chip
                  key={r.key}
                  active={roles.includes(r.key)}
                  onClick={() => toggle(roles, setRoles, r.key)}
                >
                  {r.label}
                  <b>{r.count}</b>
                </Chip>
              ))}
            </>
          ) : showSkeleton ? (
            <ChipSkeletons widths={SK_CHIPS.roles} />
          ) : null}
        </FilterRow>

        <FilterRow label="Eligibility">
          {ready ? (
            <>
              <Chip active={eligibility.length === 0} onClick={() => setEligibility([])}>
                Everywhere
                <b>{meta.total}</b>
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
                  <b>{meta.eligibility?.[e.key] ?? 0}</b>
                </Chip>
              ))}
            </>
          ) : showSkeleton ? (
            <ChipSkeletons widths={SK_CHIPS.eligibility} />
          ) : null}
        </FilterRow>

        {/* Rendered while loading too, otherwise the row appears from nowhere
            once data lands and shunts the whole list down the page. */}
        {(showSkeleton || sourceChips.length > 0) && (
          <FilterRow label="Source">
            {ready ? (
              <>
                <Chip active={sources.length === 0} onClick={() => setSources([])}>
                  All sources
                  <b>{meta.total}</b>
                </Chip>
                {sourceChips.map((s) => (
                  <Chip
                    key={s.key}
                    active={sources.includes(s.key)}
                    onClick={() => toggle(sources, setSources, s.key)}
                  >
                    {s.key}
                    <b>{s.count}</b>
                  </Chip>
                ))}
              </>
            ) : (
              <ChipSkeletons widths={SK_CHIPS.sources} />
            )}
          </FilterRow>
        )}

        {/* The default selection is non-empty, so this row is all but certain to
            be there once data lands. Hold its space rather than letting it push
            the list down on arrival. */}
        {showSkeleton && activeCount > 0 && (
          <div className="console-foot">
            <Sk w={168} h={13} r={4} />
          </div>
        )}

        {/* Gated on data, not just on having filters: the default selection is
            non-empty, so on first paint this otherwise reads "0 roles matching
            1 filter" before a single result has arrived. */}
        {ready && activeCount > 0 && (
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
                setQ("");
              }}
            >
              Clear all
            </button>
          </div>
        )}
      </section>

      <main className={`list ${pending && ready ? "is-pending" : ""}`} aria-busy={pending}>
        <p className="sr-only" role="status" aria-live="polite">
          {showSkeleton
            ? "Loading roles"
            : pending
              ? "Updating results"
              : `${jobs.length} roles`}
        </p>

        {showSkeleton && Array.from({ length: 6 }, (_, i) => <CardSkeleton key={i} />)}

        {error && (
          <Empty>
            {error}.{" "}
            {import.meta.env.DEV
              ? "Is the dev server running on port 4000?"
              : "The job data may still be publishing. Try again in a minute."}
          </Empty>
        )}
        {ready && !error && jobs.length === 0 && (
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
              onClick={() => onOpen(job.id, job.title)}
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
                  {job.paywalled && (
                    <span className="pill pill-paywall">paid to apply</span>
                  )}
                </div>

                {job.tags?.length > 0 && (
                  <div className="tags">
                    {job.tags.map((t, i) => (
                      <span key={`${t}-${i}`}>{t}</span>
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

function Stat({ value, label, accent, loading }) {
  return (
    <div className="stat">
      {loading ? (
        <Sk w={58} h={26} r={6} />
      ) : (
        <span className={`stat-value ${accent ? "stat-accent" : ""}`}>{value}</span>
      )}
      <span className="stat-label">{label}</span>
    </div>
  );
}

/** One shimmering placeholder. Sized inline so a row of them can vary. */
function Sk({ w, h, r = 6 }) {
  return <span className="sk" style={{ width: w, height: h, borderRadius: r }} aria-hidden="true" />;
}

// Traced from a loaded board rather than picked by eye. Count and width both
// matter: they decide how many lines a row wraps to, and a row that wraps to
// one line while loading and two lines afterwards shoves the whole list down
// the page at the exact moment you started reading it. Fixed, not random, so
// the placeholders do not reflow between renders either.
const SK_CHIPS = {
  windows: [80, 82, 88, 96, 86, 90, 96],
  roles: [95, 138, 72, 130, 86, 132, 92, 90, 88, 82, 88, 78, 126],
  eligibility: [114, 144, 128, 118, 148],
  sources: [110, 102, 78, 120, 110, 112, 100, 78, 68, 82, 90, 136],
};

function ChipSkeletons({ widths }) {
  // 29.5 is the measured height of a real chip, not a round number chosen by
  // eye. Rounding it to 29 left every row a pixel short and the list a dozen
  // pixels high, which is exactly the jump these are here to prevent.
  return widths.map((w, i) => <Sk key={i} w={w} h={29.5} r={8} />);
}

/** Stands in for a job card at exactly its height, so nothing shifts. */
function CardSkeleton() {
  return (
    <div className="card card-skeleton" aria-hidden="true">
      <div className="card-body">
        <div className="card-head">
          <Sk w="38%" h={17} r={5} />
          <Sk w={34} h={11} r={4} />
        </div>
        <div className="sk-meta">
          <Sk w="26%" h={12} r={4} />
        </div>
        <div className="badges">
          <Sk w={102} h={23} r={6} />
          <Sk w={70} h={23} r={6} />
          <Sk w={82} h={23} r={6} />
        </div>
      </div>
      <Sk w={68} h={13} r={4} />
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
