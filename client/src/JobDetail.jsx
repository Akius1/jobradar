import { useEffect, useState } from "react";
import { VERDICT, timeAgo, roleLabel } from "./shared.js";

export default function JobDetail({ id, onBack, onOpen }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    setData(null);
    setError(null);
    fetch(`/api/job?id=${encodeURIComponent(id)}`)
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body.error || `Error ${r.status}`);
        return body;
      })
      .then(setData)
      .catch((e) => setError(e.message));
    window.scrollTo(0, 0);
  }, [id]);

  if (error) {
    return (
      <div className="app">
        <button className="back" onClick={onBack}>
          ← Back to radar
        </button>
        <p className="empty">{error}</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="app">
        <button className="back" onClick={onBack}>
          ← Back to radar
        </button>
        <p className="empty">Loading role…</p>
      </div>
    );
  }

  const { job, prep, related } = data;
  const v = VERDICT[job.eligibility];

  return (
    <div className="app detail">
      <button className="back" onClick={onBack}>
        ← Back to radar
      </button>

      {/* ---- Masthead ---- */}
      <header className={`detail-head tone-${v.tone}`}>
        <div className="detail-head-top">
          <span className={`verdict verdict-${v.tone}`}>
            <i className={`dot dot-${v.tone}`} />
            {v.label}
          </span>
          <span className="pill">{roleLabel(job.role)}</span>
          <span className="pill pill-ghost">{prep.seniority}</span>
          {job.relocation && <span className="pill pill-visa">relocation / visa</span>}
          <span className="age">posted {timeAgo(job.postedAt)} ago</span>
        </div>

        <h1 className="detail-title">{job.title}</h1>
        <p className="detail-sub">
          <span className="company">{job.company}</span>
          <span className="sep">·</span>
          {job.locationText}
          {job.salary && (
            <>
              <span className="sep">·</span>
              <span className="salary">{job.salary}</span>
            </>
          )}
        </p>

        <div className="detail-actions">
          <a className="apply-btn" href={job.url} target="_blank" rel="noreferrer">
            Apply on {job.source} →
          </a>
          <span className="apply-note">
            {prep.approach.urgency === "high"
              ? "Apply within 24h for the best odds"
              : prep.approach.urgency === "medium"
              ? "Confirm eligibility first, see below"
              : "Read the approach below before spending time here"}
          </span>
        </div>
      </header>

      {/* ---- Why this verdict ---- */}
      <Panel label="Eligibility read" tone={v.tone}>
        <p className="panel-lead">{prep.approach.headline}</p>
        {job.signals?.length > 0 && (
          <p className="signals">
            Graded from: {job.signals.map((s) => <code key={s}>{s}</code>)}
          </p>
        )}
        <ol className="steps">
          {prep.approach.steps.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
      </Panel>

      {/* ---- What they're screening on ---- */}
      {prep.detectedSkills.length > 0 && (
        <Panel label="What they're screening on">
          <p className="panel-lead">
            Pulled from the posting. Mirror the ones you genuinely have, because many
            pipelines keyword-screen before a human reads anything.
          </p>
          <div className="skills">
            {prep.detectedSkills.map((s) => (
              <span
                key={s}
                className={`skill ${prep.headlineSkills.includes(s) ? "skill-key" : ""}`}
              >
                {s}
              </span>
            ))}
          </div>
          {prep.headlineSkills.length > 0 && (
            <p className="skill-note">
              Highlighted ones appear in the title or tags. Those are the
              non-negotiables.
            </p>
          )}
        </Panel>
      )}

      {/* ---- Positioning playbook ---- */}
      <Panel label={`Position yourself: ${roleLabel(job.role)}`}>
        <ol className="steps steps-numbered">
          {prep.focus.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
      </Panel>

      {/* ---- Reaching a human ---- */}
      {prep.outreach && (
        <Panel label="Reach a human, not an ATS">
          {prep.outreach.contacts.length > 0 ? (
            <>
              <p className="panel-lead">
                This employer published a way to apply directly.
              </p>
              <div className="contacts">
                {prep.outreach.contacts.map((c) => (
                  <a key={c.email} className="contact" href={`mailto:${c.email}`}>
                    <span className="contact-email">{c.email}</span>
                    <span className="contact-kind">{c.kind}</span>
                  </a>
                ))}
              </div>
            </>
          ) : (
            <p className="panel-lead">
              No address published in this ad. Apply officially first, then follow up.
            </p>
          )}

          <ol className="steps">
            {prep.outreach.plan.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>

          <div className="links">
            {prep.outreach.links.map((l) => (
              <a key={l.url} className="link-card" href={l.url} target="_blank" rel="noreferrer">
                <span className="link-label">{l.label} →</span>
                <span className="link-hint">{l.hint}</span>
              </a>
            ))}
          </div>
          <p className="skill-note">
            These open a search you run yourself. JobRadar does not collect or store
            anyone's contact details.
          </p>
        </Panel>
      )}

      {/* ---- Applying from Africa ---- */}
      <Panel label="Your edge applying from Africa">
        <ol className="steps">
          {prep.edge.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
      </Panel>

      {/* ---- Original posting ---- */}
      {job.description && (
        <Panel label="The posting">
          <div className="description">
            {job.description.split("\n").filter(Boolean).map((p, i) => (
              <p key={i}>{p}</p>
            ))}
          </div>
          <a className="source-link" href={job.url} target="_blank" rel="noreferrer">
            Read the full listing on {job.source} →
          </a>
        </Panel>
      )}

      {related.length > 0 && (
        <Panel label="Similar live roles">
          <div className="related">
            {related.map((r) => (
              <button key={r.id} className="related-item" onClick={() => onOpen(r.id)}>
                <span className="related-title">{r.title}</span>
                <span className="related-meta">
                  {r.company} · {timeAgo(r.postedAt)} ago
                </span>
              </button>
            ))}
          </div>
        </Panel>
      )}

      <div className="detail-foot">
        <a className="apply-btn" href={job.url} target="_blank" rel="noreferrer">
          Apply on {job.source} →
        </a>
      </div>
    </div>
  );
}

function Panel({ label, tone, children }) {
  return (
    <section className={`panel ${tone ? `panel-${tone}` : ""}`}>
      <span className="panel-label">{label}</span>
      <div className="panel-body">{children}</div>
    </section>
  );
}
