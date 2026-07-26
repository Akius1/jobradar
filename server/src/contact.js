// Routes around the ATS black hole, without harvesting anyone's personal data.
//
// Deliberate boundary: this only surfaces contact details the employer chose to
// publish inside its own job ad, and builds search links Andrew clicks himself.
// It never guesses or permutes addresses (the "firstname.lastname@company.com"
// trick), never verifies them against a mail server, and never compiles a list
// of named individuals. Those cross from research into personal-data harvesting,
// which is what gets a sender domain blacklisted and breaches the NDPA/GDPR.

const EMAIL_RX = /\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/gi;

// Addresses that exist precisely so strangers can apply.
const ROLE_ADDRESS_RX =
  /^(jobs|careers|hiring|recruiting|recruitment|talent|apply|work|join|hr|people|team|hello|info|contact)@/i;

// Noise that shows up in scraped boilerplate.
const IGNORE_RX =
  /@(example|sentry|wixpress|sentry\.io|schema\.org|w3\.org|googlegroups)\.|(\.png|\.jpg|\.svg|\.gif)$|^(noreply|no-reply|donotreply|privacy|legal|dpo|security|abuse|support|press|sales)@/i;

const APPLY_HINT_RX =
  /\b(email|send|apply|reach|contact|write|get in touch|resume|cv)\b/i;

/**
 * Pull application addresses the employer published in the posting itself.
 * Each is classified so the UI can show what kind of contact it is.
 */
export function extractContacts(description = "") {
  const text = String(description);
  const found = new Map();

  for (const raw of text.match(EMAIL_RX) || []) {
    const email = raw.toLowerCase();
    if (IGNORE_RX.test(email) || found.has(email)) continue;

    // Was it written in a sentence that invites you to get in touch?
    const idx = text.toLowerCase().indexOf(email);
    const context = text.slice(Math.max(0, idx - 120), idx + 40);
    const invited = APPLY_HINT_RX.test(context);
    const isRoleAddress = ROLE_ADDRESS_RX.test(email);

    // A personal address only counts when the poster explicitly asked to be
    // emailed about the job. Anything else is left alone.
    if (!isRoleAddress && !invited) continue;

    found.set(email, {
      email,
      kind: isRoleAddress ? "team inbox" : "named in the ad",
    });
  }

  return [...found.values()].slice(0, 4);
}

/** Deep links Andrew opens himself. No scraping, no stored profiles. */
export function outreachLinks(company, title) {
  const c = encodeURIComponent(company);
  const roleWords = encodeURIComponent(
    title.replace(/[^\w\s]/g, " ").split(/\s+/).slice(0, 3).join(" ")
  );
  return [
    {
      label: "Recruiters at this company",
      hint: "LinkedIn people search, filtered to talent roles",
      url: `https://www.linkedin.com/search/results/people/?keywords=${c}%20recruiter%20OR%20%22talent%20acquisition%22`,
    },
    {
      label: "Engineers on the team",
      hint: "Often more responsive than recruiters, and they get referral bonuses",
      url: `https://www.linkedin.com/search/results/people/?keywords=${c}%20${roleWords}`,
    },
    {
      label: "The company's own careers page",
      hint: "Roles here are frequently ahead of the aggregators",
      url: `https://www.google.com/search?q=${c}+careers+jobs`,
    },
    {
      label: "Recent chatter about this role",
      hint: "Hiring managers often post openings on X before the ad goes live",
      url: `https://x.com/search?q=${c}%20hiring&f=live`,
    },
  ];
}

/** How to approach the outreach, tuned to what the posting actually gave us. */
export function outreachPlan(contacts, source) {
  const steps = [];

  if (contacts.length) {
    steps.push(
      `This employer published an application address in the ad itself, so use it. A short, specific email beats a form submission because it lands in a human's inbox rather than an ATS queue.`
    );
  } else {
    steps.push(
      "No address was published in this ad, so apply through the official link first. Treat outreach as a follow-up, not a replacement."
    );
  }

  if (source === "HackerNews") {
    steps.push(
      "This came from a Who is hiring thread, which means a founder or engineering lead posted it directly. Reply in the thread as well as emailing; visible, thoughtful replies get noticed."
    );
  }
  if (["Greenhouse", "Lever", "Ashby"].includes(source)) {
    steps.push(
      "This is straight from the company's own board, so it may not be on the big aggregators yet. Applying now puts you in a much smaller pile."
    );
  }

  steps.push(
    "Find the hiring manager or an engineer on the team rather than a recruiter. Ask one specific question about the work; that converts far better than asking someone to review your CV."
  );
  steps.push(
    "Keep it to five sentences: what you build, one relevant proof link, your timezone overlap, and a direct ask. Send it the same day the role appears."
  );

  return steps;
}
