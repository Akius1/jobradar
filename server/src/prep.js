// Turns a posting into an actionable "how do I win this one" brief:
// the stack it actually asks for, role-specific positioning moves, an approach
// tuned to the eligibility verdict, and the tactics that matter when you're
// applying from Nigeria into a global remote market.

const SKILLS = [
  ["React", /\breact(\.js|js)?\b/i],
  ["Next.js", /\bnext\.?js\b/i],
  ["Vue", /\bvue(\.js|js)?\b/i],
  ["Angular", /\bangular\b/i],
  ["Svelte", /\bsvelte(kit)?\b/i],
  ["TypeScript", /\btypescript\b|\bts\b(?![a-z])/i],
  ["JavaScript", /\bjavascript\b/i],
  ["Node.js", /\bnode(\.js|js)?\b/i],
  ["Python", /\bpython\b/i],
  ["Go", /\bgolang\b|\bgo\b(?= developer| engineer)/i],
  ["Java", /\bjava\b(?!script)/i],
  ["Ruby on Rails", /\bruby\b|\brails\b/i],
  ["PHP / Laravel", /\bphp\b|\blaravel\b/i],
  // Lookbehind stops "example.net" in a URL being read as the .NET framework.
  [".NET / C#", /(?<![\w])\.net\b|\bc#/i],
  ["GraphQL", /\bgraphql\b/i],
  ["REST APIs", /\brest(ful)?\b.{0,10}api|\bapi design\b/i],
  ["PostgreSQL", /\bpostgres(ql)?\b/i],
  ["MySQL", /\bmysql\b/i],
  ["MongoDB", /\bmongo(db)?\b/i],
  ["Redis", /\bredis\b/i],
  ["AWS", /\baws\b|\bamazon web services\b/i],
  ["GCP", /\bgcp\b|\bgoogle cloud\b/i],
  ["Azure", /\bazure\b/i],
  ["Docker", /\bdocker\b/i],
  ["Kubernetes", /\bkubernetes\b|\bk8s\b/i],
  ["Terraform", /\bterraform\b/i],
  ["CI/CD", /\bci\/cd\b|\bcontinuous (integration|deployment)\b/i],
  ["Testing", /\bjest\b|\bcypress\b|\bplaywright\b|\bvitest\b|\bunit test/i],
  ["Tailwind", /\btailwind\b/i],
  ["React Native", /\breact native\b/i],
  ["Flutter", /\bflutter\b/i],
  ["Swift", /\bswift\b/i],
  ["Kotlin", /\bkotlin\b/i],
  ["PyTorch", /\bpytorch\b/i],
  ["TensorFlow", /\btensorflow\b/i],
  ["LLMs", /\bllm\b|\blarge language model|\bopenai\b|\banthropic\b/i],
  ["Solidity", /\bsolidity\b/i],
  ["Accessibility", /\ba11y\b|\baccessibility\b|\bwcag\b/i],
  ["Design Systems", /\bdesign system/i],
  ["Micro-frontends", /\bmicro[\s-]?frontend/i],
  ["Web Performance", /\bcore web vitals\b|\bperformance optimi[sz]/i],
];

const SENIORITY = [
  ["Junior", /\bjunior\b|\bentry[\s-]level\b|\bgraduate\b/i],
  ["Senior", /\bsenior\b|\bsr\.?\b/i],
  ["Staff / Principal", /\bstaff\b|\bprincipal\b/i],
  ["Lead", /\blead\b|\bhead of\b|\bmanager\b|\bdirector\b/i],
];

// What actually moves the needle per discipline. Kept concrete, no "be passionate".
const PLAYBOOKS = {
  frontend: [
    "Ship one deployed demo that mirrors their product surface, not a to-do app. Put the live link at the very top of your CV.",
    "Record a 90-second Loom walking through one component's state management and why you designed it that way.",
    "Run Lighthouse on your demo and get Performance + Accessibility above 95, then screenshot it in your application.",
    "Be ready to whiteboard a component API. Most frontend interviews now test design sense, not DOM trivia.",
  ],
  fullstack: [
    "Show one project where you own the whole path: schema → API → UI → deploy. A single coherent app beats five fragments.",
    "Document one architecture decision you made and the tradeoff you accepted. Seniors are hired for judgement, not syntax.",
    "Have a database story ready: an N+1 you fixed, an index you added, a migration you ran without downtime.",
    "Deploy it somewhere real with CI. 'It runs locally' reads as junior.",
  ],
  backend: [
    "Prepare one concrete scaling story: what broke, how you measured it, what you changed, the numbers after.",
    "Publish an API with real docs (OpenAPI or a clean README). Shows you build for other engineers, not just yourself.",
    "Know your primary database deeply: indexing, transactions, isolation levels. It comes up in almost every backend loop.",
    "Have opinions on error handling, retries and idempotency. This separates mid from senior fast.",
  ],
  devops: [
    "Put an IaC repo on GitHub (Terraform or Pulumi) provisioning something real, with a README explaining the topology.",
    "Prepare one incident story in full: detection, diagnosis, mitigation, the postmortem action you shipped.",
    "Show cost awareness. Naming a bill you cut is unusually persuasive to hiring managers.",
    "Be fluent in one cloud rather than shallow in three. Depth wins the interview.",
  ],
  "ai-ml": [
    "Publish one notebook or small app with an honest evaluation section: metrics, failure cases, what you'd try next.",
    "If it's an LLM role, show a working RAG or agent pipeline plus how you evaluated output quality, not just that it runs.",
    "Be able to explain your model choice against a simpler baseline. 'Why not logistic regression?' is a real question.",
    "Read their recent papers or engineering blog and reference one specifically in your application.",
  ],
  data: [
    "Build one end-to-end pipeline: ingest → transform → model → dashboard, with the code public.",
    "Sharpen SQL to window functions and CTEs. Nearly every data loop has a live SQL round.",
    "Show one analysis that changed a decision. The business outcome matters more than the chart.",
    "Know dbt or an orchestrator (Airflow, Dagster). It's the default expectation now.",
  ],
  mobile: [
    "Get one app in a store, even a tiny one. A public listing outweighs any amount of described experience.",
    "Prepare a story on offline behaviour, state restoration, or battery/network handling, the real mobile problems.",
    "Show screenshots and a short video in the application itself. Mobile hiring is visual.",
    "Know the platform's release and review process. Signals you've actually shipped.",
  ],
  qa: [
    "Publish an automation suite against a real public site using Playwright or Cypress, with CI running it.",
    "Show a bug report you wrote that's genuinely excellent: reproduction, severity, environment, evidence.",
    "Be ready to design a test strategy out loud for a feature they describe. That's the core QA interview.",
    "Frame yourself as quality engineering, not manual testing. It changes the salary band.",
  ],
  security: [
    "Point to CTF results, CVEs, HackerOne reports, or a public writeup. Security hiring wants proof, not certificates alone.",
    "Be able to walk the OWASP Top 10 with a real-world example of each, not just the names.",
    "Show one thing you fixed, not only broke. Defensive judgement is what most of these roles pay for.",
    "If they're a product company, review their public surface before the call and bring one careful observation.",
  ],
  blockchain: [
    "Deploy a verified contract on a testnet and link the explorer page. Verifiable on-chain history is your CV here.",
    "Know the common vulnerability classes (reentrancy, oracle manipulation, integer issues) with mitigations.",
    "Contribute a real PR to a protocol repo. Web3 hiring leans heavily on public commits.",
    "Understand gas costs concretely. It's the constraint that shapes every design decision.",
  ],
  game: [
    "A playable build beats everything. Put it on itch.io and link it first.",
    "Show one technical deep-dive: a shader, a pathfinding system, a physics quirk you solved.",
    "Demonstrate profiling work. Frame budget is the whole discipline.",
    "Match their engine exactly. Unity and Unreal shops rarely cross-hire.",
  ],
  embedded: [
    "Document one hardware project with schematics, photos and the debugging story.",
    "Be strong on C fundamentals: memory, interrupts, timing. It's tested directly.",
    "Show you can read a datasheet and act on it. Bring an example.",
    "Mention any experience with certification or safety standards if you have it. It's rare and valued.",
  ],
  leadership: [
    "Prepare three stories in STAR form: a conflict you resolved, a delivery you turned around, someone you grew.",
    "Bring numbers: team size, delivery cadence, retention, scope. Leadership interviews want measurable impact.",
    "Have a clear, statable philosophy on code review, on-call and hiring.",
    "Show you still read code. The best engineering managers never fully leave it.",
  ],
  engineering: [
    "Pick your single strongest project and make its README excellent: problem, architecture, tradeoffs, live link.",
    "Prepare one deep technical story you can defend for fifteen minutes of follow-up questions.",
    "Practise thinking out loud. Most loops score communication as heavily as the solution.",
    "Mirror the language of this posting back in your CV. Many pipelines still screen on keywords first.",
  ],
};

const APPROACH = {
  eligible: {
    headline: "Green light, move fast",
    urgency: "high",
    steps: [
      "Worldwide roles collect hundreds of applicants within days. Applying inside the first 24 hours measurably changes your odds.",
      "Tailor the top third of your CV to this posting specifically. Everything below can stay standard.",
      "Find the hiring manager or a team engineer on LinkedIn and send a short, specific note after applying.",
    ],
  },
  maybe: {
    headline: "Confirm before you invest",
    urgency: "medium",
    steps: [
      "The posting doesn't state its geography policy, so don't burn hours on a tailored application yet.",
      "Send a two-line email or LinkedIn message first: 'Do you hire contractors based in Nigeria for this role?' A clear answer costs you five minutes.",
      "If they confirm, treat it as a green light and apply the same day.",
      "Many of these are genuinely open. Companies just forget to say so. Worth the ask.",
    ],
  },
  restricted: {
    headline: "Long shot, apply selectively",
    urgency: "low",
    steps: [
      "This one names a country or timezone you'd need to be in, so expect a low hit rate.",
      "Only worth it if you'd genuinely relocate, or if your profile is unusually strong for the stack.",
      "If you apply, address it head-on in line one: state your timezone overlap and your visa position. Don't make them guess.",
      "Better use of the same hour: two applications from the Africa-friendly list.",
    ],
  },
};

// The part generic job boards never tell you.
const EDGE = [
  "Lead with timezone overlap in your first line. 'I work 10:00 to 19:00 WAT, which is a 5-hour overlap with US Eastern' removes their main silent objection.",
  "Say you can be paid through Deel, Remote.com or Wise. Removing payment friction makes you materially easier to hire.",
  "Point to async proof: a well-written PR description, an RFC, clear issue threads. Remote teams hire on written communication.",
  "Use a clean, plain CV with a live portfolio link. Skip photos and graphics, many ATS parsers mangle them.",
  "Never open with your location as an apology. Lead with the work, state logistics matter-of-factly.",
];

import { extractContacts, outreachLinks, outreachPlan } from "./contact.js";

/** Build the full positioning brief for one job. */
export function buildPrep(job) {
  const haystack = `${job.title} ${(job.tags || []).join(" ")} ${job.description || ""}`;

  const detectedSkills = SKILLS.filter(([, rx]) => rx.test(haystack)).map(([name]) => name);
  const seniority = SENIORITY.find(([, rx]) => rx.test(job.title))?.[0] || "Mid-level";

  return {
    seniority,
    detectedSkills,
    // Skills named in the title or tags are what they're really screening on.
    headlineSkills: SKILLS.filter(([, rx]) =>
      rx.test(`${job.title} ${(job.tags || []).join(" ")}`)
    )
      .map(([name]) => name)
      .slice(0, 6),
    focus: PLAYBOOKS[job.role] || PLAYBOOKS.engineering,
    approach: APPROACH[job.eligibility],
    edge: EDGE,
    outreach: {
      contacts: extractContacts(job.description),
      links: outreachLinks(job.company, job.title),
      plan: outreachPlan(extractContacts(job.description), job.source),
    },
  };
}
