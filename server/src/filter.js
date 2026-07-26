// Role taxonomy + Africa-eligibility scoring for normalized job objects.

// Anything clearly not an engineering role gets dropped outright.
const NON_TECH_RX =
  /\b(recruiter|talent acquisition|marketing|sales|account executive|business development|customer (support|success|service)|human resources|accountant|bookkeeper|copywriter|content (writer|reviewer)|social media|community manager|paralegal|legal counsel|virtual assistant|teacher|tutor|nurse|therapist|video editor|graphic designer|illustrator|translator|moderator)\b/i;

/**
 * Ordered most-specific → most-general. The first pattern to match a title wins,
 * so "Machine Learning Engineer" lands in ai-ml rather than the generic bucket.
 */
export const ROLES = [
  {
    key: "ai-ml",
    label: "AI / ML",
    rx: /\b(machine learning|ml engineer|mlops|a\.?i\.? engineer|artificial intelligence|deep learning|nlp|computer vision|llm|generative ai|prompt engineer|research scientist)\b/i,
  },
  {
    key: "data",
    label: "Data",
    rx: /\b(data (engineer|scientist|analyst|architect)|analytics engineer|business intelligence|\bbi developer\b|etl|data warehouse|databricks|snowflake|(engenheiro|engenheira|cientista|analista) de dados|(ingeniero|ingeniera|cient(i|í)fico) de datos)\b/i,
  },
  {
    key: "security",
    label: "Security",
    rx: /\b(security engineer|application security|appsec|infosec|cyber ?security|penetration test|pentester|security analyst|security architect|cryptograph)\b/i,
  },
  {
    key: "blockchain",
    label: "Blockchain / Web3",
    rx: /\b(blockchain|web3|solidity|smart contract|defi|crypto engineer|protocol engineer|rust.*(blockchain|protocol))\b/i,
  },
  {
    key: "game",
    label: "Game Dev",
    rx: /\b(game (developer|engineer|programmer|designer)|gameplay|unity developer|unreal|godot)\b/i,
  },
  {
    key: "embedded",
    label: "Embedded / IoT",
    rx: /\b(embedded|firmware|iot engineer|rtos|hardware engineer|fpga|verilog|robotics)\b/i,
  },
  {
    key: "mobile",
    label: "Mobile",
    rx: /\b(mobile (developer|engineer)|ios (developer|engineer)|android (developer|engineer)|react native|flutter|swift developer|kotlin developer)\b/i,
  },
  {
    key: "devops",
    label: "DevOps / Cloud",
    rx: /\b(devops|sre|site reliability|platform engineer|infrastructure engineer|cloud (engineer|architect)|kubernetes|systems engineer|network engineer|solutions architect)\b/i,
  },
  {
    key: "qa",
    label: "QA / Test",
    rx: /\b(qa engineer|quality assurance|sdet|test engineer|test automation|automation engineer|qa analyst|software tester)\b/i,
  },
  {
    key: "fullstack",
    label: "Fullstack",
    rx: /\b(full[\s-]?stack|mern|mean stack)\b/i,
  },
  {
    key: "frontend",
    label: "Frontend",
    rx: /\b(front[\s-]?end|react(\.js|js)?(?! native)|vue(\.js|js)?|angular|svelte|next\.?js|ui engineer|ui developer|web developer|webgl|design engineer)\b/i,
  },
  {
    key: "backend",
    label: "Backend",
    rx: /\b(back[\s-]?end|node(\.js|js)? (developer|engineer)|python (developer|engineer)|golang|go developer|java (developer|engineer)|ruby|rails|php|laravel|\.net|c#|scala|elixir|api engineer|server[\s-]?side|database (engineer|administrator)|\bdba\b)\b/i,
  },
  {
    key: "leadership",
    label: "Lead / Manager",
    rx: /\b(engineering manager|tech(nical)? lead|team lead|head of engineering|vp of engineering|director of engineering|principal engineer|staff engineer|architect)\b/i,
  },
];

// Titles too generic to place on their own, we inspect tags instead.
// Includes Portuguese and Spanish equivalents so Brazilian and wider LatAm
// postings are not silently discarded as non-technical.
const GENERIC_RX =
  /\b(software (engineer|developer)|developer|engineer|programmer|coder|software development|desenvolvedor|desenvolvedora|programador|programadora|engenheiro|engenheira|desarrollador|desarrolladora|ingeniero|ingeniera|softwareentwickler|entwickler)\b/i;

const TAG_HINTS = [
  ["frontend", ["react", "reactjs", "vue", "vuejs", "angular", "svelte", "frontend", "front end", "front-end", "nextjs", "next.js", "ui", "css", "html", "tailwind"]],
  ["backend", ["node", "nodejs", "node.js", "backend", "back end", "back-end", "express", "nestjs", "django", "flask", "rails", "laravel", "golang", "java", "spring", "api", "postgres", "mysql", "mongodb"]],
  ["devops", ["devops", "kubernetes", "docker", "aws", "azure", "gcp", "terraform", "sre", "cloud", "infrastructure", "ci/cd"]],
  ["ai-ml", ["machine learning", "ml", "ai", "pytorch", "tensorflow", "llm", "nlp", "deep learning"]],
  ["data", ["data", "sql", "analytics", "etl", "spark", "airflow", "bigquery"]],
  ["mobile", ["ios", "android", "react native", "flutter", "swift", "kotlin", "mobile"]],
  ["security", ["security", "cybersecurity", "appsec", "infosec"]],
  ["blockchain", ["blockchain", "web3", "solidity", "crypto", "ethereum"]],
  ["qa", ["qa", "testing", "test", "automation", "selenium", "cypress"]],
];

/**
 * Classify a posting. Returns a role key, or null when it isn't a software role.
 * Falls back to tag inspection for generic titles like "Software Engineer".
 */
export function classifyRole(title, tags = []) {
  if (!title || NON_TECH_RX.test(title)) return null;

  for (const { key, rx } of ROLES) {
    if (rx.test(title)) return key;
  }

  if (GENERIC_RX.test(title)) {
    const lower = tags.map((t) => String(t).toLowerCase().replace(/[-_]/g, " "));
    const hit = (list) => list.some((t) => lower.some((l) => l.includes(t)));

    if (hit(["full stack", "fullstack"])) return "fullstack";
    const matched = TAG_HINTS.filter(([, list]) => hit(list)).map(([k]) => k);
    if (matched.includes("frontend") && matched.includes("backend")) return "fullstack";
    if (matched.length) return matched[0];
    return "engineering"; // genuinely general software role
  }

  return null;
}

/** Role list including the generic bucket, for UI rendering. */
export const ROLE_LABELS = [
  ...ROLES.map(({ key, label }) => ({ key, label })),
  { key: "engineering", label: "General Software" },
];

// ---- Africa eligibility ----

const GREAT_RX =
  /\b(worldwide|anywhere|global(ly)?|africa|nigeria|kenya|ghana|egypt|south africa|emea|any location|all countries|international|100% remote)\b/i;
const RELOCATION_RX = /\b(relocation|visa sponsorship|sponsorship available|relocate)\b/i;
const RESTRICTED_RX =
  /\b(usa? only|usa\b|u\.s(\.a)?|us[\s-]based|united states|us citizens?|north america|canada|latam|latin america|americas|(?<!outside )europe(an)? only|eu only|eu[\s-]based|uk only|uk[\s-]based|united kingdom|germany|netherlands|poland|australia|new zealand|apac|asia[\s-]pacific|india only|est timezone|pst timezone|cst timezone|within the (us|eu))\b/i;

// A location field that carries no geographic commitment either way.
const GENERIC_LOC_RX = /^\s*(remote|remote worldwide|fully remote|anywhere|flexible|n\/?a|-|-|)\s*$/i;

/**
 * Returns { eligibility: "eligible" | "maybe" | "restricted", signals: string[] }
 * based on location text (strong signal) and description text (weak signal).
 */
export function scoreEligibility(locationText = "", descriptionText = "") {
  const loc = (locationText || "").trim();
  const signals = [];

  const relocation = RELOCATION_RX.test(loc) || RELOCATION_RX.test(descriptionText);
  if (relocation) signals.push("relocation/visa");

  // The location field is the strong signal, it's the employer's own statement.
  if (GREAT_RX.test(loc)) {
    signals.push(loc.match(GREAT_RX)[0].toLowerCase());
    return { eligibility: "eligible", signals };
  }
  if (RESTRICTED_RX.test(loc)) {
    signals.push(`restricted: ${loc.match(RESTRICTED_RX)[0].toLowerCase()}`);
    // Relocation support softens a hard restriction, but doesn't clear it.
    return { eligibility: relocation ? "maybe" : "restricted", signals };
  }

  // Location names a specific place we have no rule for (e.g. "Ecuador").
  // Boilerplate like "we're a global team" in the description is far too weak
  // to overturn that, so this caps at "worth a shot" unless relocation is offered.
  if (!GENERIC_LOC_RX.test(loc)) {
    signals.push(`based in ${loc.toLowerCase()}`);
    return { eligibility: relocation ? "eligible" : "maybe", signals };
  }

  // Location is generic ("Remote"), so the description is all we have.
  if (GREAT_RX.test(descriptionText)) {
    signals.push("description mentions global/worldwide");
    return { eligibility: "eligible", signals };
  }
  if (RESTRICTED_RX.test(descriptionText)) {
    signals.push("description hints at a region restriction");
    return { eligibility: "maybe", signals };
  }
  return { eligibility: relocation ? "eligible" : "maybe", signals };
}

/**
 * Sources hand us HTML in varying states of escaping, WeWorkRemotely's RSS
 * double-escapes it, so "&lt;p&gt;" arrives as literal text. Decode the angle
 * brackets first, then strip tags, then decode everything else. Doing it in any
 * other order leaves markup visible in the UI.
 */
function cleanDescription(raw = "") {
  let s = String(raw).replace(/&lt;/gi, "<").replace(/&gt;/gi, ">");

  s = s
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li[^>]*>/gi, "\n• ")
    .replace(/<\/(p|div|h\d|ul|ol|tr|section)>/gi, "\n")
    .replace(/<[^>]+>/g, " ");

  s = s
    .replace(/&nbsp;/gi, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&(quot|ldquo|rdquo);/gi, '"')
    .replace(/&(apos|rsquo|lsquo);/gi, "'")
    .replace(/&(mdash|ndash);/gi, "-")
    .replace(/&amp;/gi, "&"); // last, so we don't re-decode our own output

  return s
    .replace(/[—–]/g, "-") // normalise scraped dashes to plain hyphens
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 4000);
}

/** Full pipeline for a raw normalized job → enriched job, or null if not relevant. */
export function processJob(raw) {
  const role = classifyRole(raw.title, raw.tags);
  if (!role) return null;
  const { eligibility, signals } = scoreEligibility(raw.locationText, raw.description);
  return {
    id: raw.id,
    source: raw.source,
    title: raw.title.trim(),
    company: (raw.company || "Unknown").trim(),
    url: raw.url,
    locationText: (raw.locationText || "Remote").replace(/[—–]/g, "-").trim(),
    salary: raw.salary || null,
    tags: (raw.tags || []).slice(0, 6),
    postedAt: raw.postedAt,
    role,
    eligibility,
    signals,
    // Orthogonal to the verdict: a restricted role that sponsors a visa is
    // still reachable, so relocation is filterable on its own.
    relocation: signals.includes("relocation/visa"),
    // Kept for the detail view and skill extraction.
    description: cleanDescription(raw.description),
  };
}
