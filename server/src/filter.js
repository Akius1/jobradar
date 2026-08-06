// Role taxonomy + Africa-eligibility scoring for normalized job objects.

// Anything clearly not an engineering role gets dropped outright.
const NON_TECH_RX =
  /\b(recruiter|talent acquisition|marketing|sales|account executive|business (development|developer)|customer (support|success|service)|human resources|accountant|accounting|accounts payable|payroll|auditor|bookkeeper|copywriter|content (writer|reviewer)|social media|community manager|paralegal|legal counsel|virtual assistant|teacher|tutor|nurse|therapist|pharmac(y|ist)|physician|dentist|veterinar|clinical (research|trial)|video editor|graphic designer|illustrator|translator|moderator|rater|annotator|annotation|data (entry|capture|labell?ing)|transcription)\b/i;

// Roles that sit next to engineering without being engineering. Kept separate
// from NON_TECH_RX only for readability, they are applied the same way.
//
// "Solutions engineer" and its siblings are customer-facing pre-sales roles at
// most companies, which is why they are here while "solutions architect" — a
// genuine infrastructure title — stays in the DevOps bucket below.
const ADJACENT_RX =
  /\b(product (manager|owner|marketing)|project manager|program manager|scrum master|business analyst|product designer|ux researcher|delivery manager|sales engineer|pre[\s-]?sales|solutions? engineer|solution engineering|customer engineer|support engineer|field engineer|implementation (engineer|consultant)|technical account manager|solutions? consultant)\b/i;

// Engineering disciplines that are not software. "Hardware" and "firmware" are
// deliberately absent: those are the embedded bucket's bread and butter.
const NON_SOFTWARE_DISCIPLINES =
  "civil|structural|mechanical|mechatronics|electrical|electronics?|chemical|biomedical|aerospace|industrial|manufacturing|mining|petroleum|environmental|hvac|geotechnical|architectural";

// Two shapes, because both turn up. The filler words in the first matter: the
// real titles are "Mechanical Design Engineer" and "Electrical Test Engineer",
// not the bare pair. The second catches the discipline trailing in brackets,
// as in "PhD Engineer (Electrical, Mechanical, Chemical)". That branch is
// deliberately limited to a parenthetical so it cannot swallow a genuine
// software title like "Software Engineer, Industrial IoT".
const NON_SOFTWARE_ENG_RX = new RegExp(
  `\\b((${NON_SOFTWARE_DISCIPLINES})(\\s+[a-z]+){0,2}\\s+engineer(ing)?\\b` +
    `|engineer(ing)?\\s*\\([^)]*\\b(${NON_SOFTWARE_DISCIPLINES})\\b)`,
  "i"
);

/**
 * Ordered most-specific → most-general. The first pattern to match a title wins,
 * so "Machine Learning Engineer" lands in ai-ml rather than the generic bucket.
 */
export const ROLES = [
  {
    key: "ai-ml",
    label: "AI / ML",
    rx: /\b(machine learning|ml engineer|ml ?ops|a\.?i\.? (engineer|automation|platform)|artificial intelligence|deep learning|nlp|computer vision|llm|generative ai|prompt engineer|research scientist|applied scientist)\b/i,
  },
  {
    key: "data",
    label: "Data",
    rx: /\b(data (engineer|scientist|analyst|architect)|analytics engineer|business intelligence|\bbi developer\b|etl|data warehouse|databricks|snowflake|(engenheiro|engenheira|cientista|analista) de dados|(ingeniero|ingeniera|cient(i|í)fico) de datos)\b/i,
  },
  {
    key: "security",
    label: "Security",
    rx: /\b(security (engineer|analyst|architect|automation|operations|platform|software|infrastructure|detection)|application security|appsec|infosec|cyber ?security|penetration test|pentester|cryptograph|soc analyst|siem|iam engineer|identity and access)\b/i,
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
    rx: /\b(embedded|firmware|iot engineer|rtos|hardware(\s+[a-z]+){0,2}\s+engineer|fpga|verilog|robotics|kernel engineer|device driver)\b/i,
  },
  {
    key: "mobile",
    label: "Mobile",
    rx: /\b(mobile (developer|engineer)|ios (developer|engineer)|android (developer|engineer)|react native|flutter|swift developer|kotlin developer)\b/i,
  },
  {
    key: "devops",
    label: "DevOps / Cloud",
    rx: /\b(devops|sre|site reliability|platform engineer|platform infrastructure|infrastructure engineer|cloud (engineer|architect|infrastructure)|kubernetes|systems? engineer|network engineer|solutions? architect|linux (engineer|administrator)|sysadmin|system(s)? administrator|dev ?ex|developer (experience|productivity)|build engineer|release engineer|observability)\b/i,
  },
  {
    key: "qa",
    label: "QA / Test",
    // "automation engineer" on its own is too broad: it swallowed security,
    // AI and lab-automation roles. It has to be qualified as test automation.
    rx: /\b(qa engineer|quality (assurance|engineer)|sdet|test engineer|test automation|(test|qa|quality) automation engineer|qa analyst|software tester)\b/i,
  },
  {
    key: "fullstack",
    label: "Fullstack",
    rx: /\b(full[\s-]?stack|mern|mean stack)\b/i,
  },
  {
    key: "frontend",
    label: "Frontend",
    // No bare "design engineer": it matched "Mechanical Design Engineer" and
    // "Principal Hardware Design Engineer" far more often than a web role.
    rx: /\b(front[\s-]?end|react(\.js|js)?(?! native)|vue(\.js|js)?|angular|svelte|next\.?js|ui engineer|ui developer|web developer|webgl|webflow|(web|ux|design systems?) design engineer)\b/i,
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
  if (!title) return null;
  if (NON_TECH_RX.test(title) || ADJACENT_RX.test(title)) return null;
  if (NON_SOFTWARE_ENG_RX.test(title)) return null;

  for (const { key, rx } of ROLES) {
    if (rx.test(title)) return key;
  }

  if (GENERIC_RX.test(title)) {
    const normalized = tags.map((t) => String(t).toLowerCase().replace(/[-_]/g, " ").trim());
    // Single-word hints are compared token by token, never as substrings:
    // "Email" contains "ai" and "HTML" contains "ml", which used to file
    // ordinary web roles under AI/ML.
    const tokens = new Set(normalized.flatMap((t) => t.split(/[^a-z0-9+#./]+/).filter(Boolean)));
    const hit = (list) =>
      list.some((t) =>
        t.includes(" ") ? normalized.some((l) => l.includes(t)) : tokens.has(t)
      );
    const score = (list) =>
      list.filter((t) =>
        t.includes(" ") ? normalized.some((l) => l.includes(t)) : tokens.has(t)
      ).length;

    if (hit(["full stack", "fullstack"])) return "fullstack";

    // Rank by how many hints a bucket actually matched, so one stray tag cannot
    // outvote a clear signal. Ties fall back to TAG_HINTS order.
    const ranked = TAG_HINTS.map(([key, list]) => [key, score(list)])
      .filter(([, n]) => n > 0)
      .sort((a, b) => b[1] - a[1]);
    const matched = ranked.map(([k]) => k);

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

// The employer states no geographic limit at all.
const WORLDWIDE_RX =
  /\b(worldwide|world[\s-]?wide|anywhere|globally|global team|any location|any country|all countries|international|location[\s-]?independent|fully distributed|no location requirement)\b/i;

// Places that include Africa, so an African applicant is inside the stated area.
// EMEA and MENA both span African countries, which is why they sit here.
const AFRICA_RX =
  /\b(africa|african|emea|mena|sub[\s-]?saharan|nigeria|lagos|abuja|kenya|nairobi|ghana|accra|egypt|cairo|morocco|casablanca|rabat|tunisia|tunis|algeria|algiers|ethiopia|addis ababa|uganda|kampala|tanzania|dar es salaam|rwanda|kigali|senegal|dakar|ivory coast|c(o|ô)te d'ivoire|abidjan|cameroon|douala|zambia|lusaka|zimbabwe|harare|botswana|gaborone|namibia|windhoek|mozambique|maputo|angola|luanda|mauritius|libya|sudan|somalia|malawi|mali|burkina faso|benin|togo|niger|gabon|congo|madagascar|cape town|johannesburg|pretoria|durban)\b/i;

const RELOCATION_RX = /\b(relocation|visa sponsorship|sponsorship available|relocate)\b/i;

// Places that exclude Africa. Grouped by continent purely for maintainability,
// they are all matched as one alternation. Cities are listed alongside their
// countries because boards very often give only a city ("London", "Berlin").
const US_STATES =
  "alabama|alaska|arizona|arkansas|california|colorado|connecticut|delaware|florida|georgia|hawaii|idaho|illinois|indiana|iowa|kansas|kentucky|louisiana|maine|maryland|massachusetts|michigan|minnesota|mississippi|missouri|montana|nebraska|nevada|new hampshire|new jersey|new mexico|north carolina|north dakota|ohio|oklahoma|oregon|pennsylvania|rhode island|south carolina|south dakota|tennessee|texas|utah|vermont|virginia|washington|west virginia|wisconsin|wyoming";
const NORTH_AMERICA =
  "united states|u\\.s\\.a?\\.?|usa|north america|canada|canadian|ontario|quebec|qu(e|é)bec|alberta|british columbia|manitoba|saskatchewan|nova scotia|new brunswick|mexico|toronto|vancouver|montreal|ottawa|calgary|new york|nyc|brooklyn|san francisco|bay area|silicon valley|seattle|austin|boston|chicago|los angeles|san diego|denver|atlanta|miami|dallas|houston|philadelphia|portland|phoenix|nashville|salt lake city|minneapolis|detroit|honolulu|st\\. louis|palo alto|mountain view|sunnyvale|san jose|santa clara|redmond|boulder|raleigh|charlotte|columbus|indianapolis|kansas city|las vegas|sacramento|tampa|orlando|pittsburgh|cincinnati|cleveland|milwaukee|san antonio|fort worth|jacksonville|memphis|louisville|oklahoma city|tucson|albuquerque|omaha|tulsa|arlington|tysons|reston|mclean|" +
  US_STATES;
const LATIN_AMERICA =
  "latam|latin america|south america|brazil|brasil|argentina|chile|colombia|peru|uruguay|ecuador|bolivia|paraguay|venezuela|costa rica|panama|guatemala|s(a|ã)o paulo|buenos aires|bogot(a|á)|lima|santiago|montevideo|medell(i|í)n|cali|barranquilla|el salvador|honduras|nicaragua|belize|guyana|suriname|bahamas|jamaica|cuba|haiti|dominican republic|puerto rico|trinidad|barbados|guadalajara|monterrey|quito|guayaquil|asunci(o|ó)n|caracas|rosario|c(o|ó)rdoba|curitiba|rio de janeiro|belo horizonte|bras(i|í)lia|porto alegre|recife|fortaleza|florian(o|ó)polis|campinas";
const EUROPE =
  "europe|european|eea|dach|benelux|nordics?|balkans|united kingdom|england|scotland|wales|ireland|britain|british|london|manchester|birmingham|bristol|cardiff|edinburgh|glasgow|leeds|cambridge|oxford|shoreditch|dublin|cork|belfast|germany|deutschland|german|berlin|munich|m(u|ü)nchen|hamburg|frankfurt|cologne|k(o|ö)ln|stuttgart|d(u|ü)sseldorf|leipzig|dresden|n(u|ü)rnberg|nuremberg|hannover|bremen|essen|dortmund|bochum|bonn|mannheim|karlsruhe|jena|m(u|ü)nster|eschborn|konstanz|heidelberg|chemnitz|augsburg|erlangen|regensburg|freiburg|kassel|aachen|wolfsburg|ingolstadt|darmstadt|mainz|wiesbaden|braunschweig|bielefeld|duisburg|wuppertal|magdeburg|erfurt|w(u|ü)rzburg|heilbronn|osnabr(u|ü)ck|paderborn|l(u|ü)beck|potsdam|kiel|rostock|nordrhein|westfalen|bayern|hessen|sachsen|saxony|baden|w(u|ü)rttemberg|niedersachsen|brandenburg|france|paris|lyon|toulouse|marseille|bordeaux|nantes|spain|espa(n|ñ)a|madrid|barcelona|valencia|seville|m(a|á)laga|portugal|lisbon|lisboa|porto|italy|italia|milan|milano|rome|roma|turin|netherlands|holland|amsterdam|rotterdam|utrecht|eindhoven|the hague|noord-holland|belgium|brussels|antwerp|ghent|luxembourg|switzerland|zurich|z(u|ü)rich|geneva|basel|bern|austria|vienna|wien|graz|salzburg|poland|warsaw|krak(o|ó)w|krakow|wroc(l|ł)aw|gdansk|poznan|czechia|czech|prague|praha|brno|slovakia|bratislava|hungary|budapest|romania|bucharest|cluj|bulgaria|sofia|greece|athens|croatia|zagreb|slovenia|ljubljana|serbia|belgrade|ukraine|kyiv|kiev|lviv|estonia|tallinn|latvia|riga|lithuania|vilnius|finland|helsinki|sweden|stockholm|gothenburg|malm(o|ö)|norway|oslo|denmark|copenhagen|iceland|reykjavik|cyprus|malta|belarus|minsk|moldova|albania|bosnia|herzegovina|montenegro|macedonia|kosovo|andorra|monaco|liechtenstein|san marino|russia|russian federation|moscow";
const ASIA_PACIFIC =
  "apac|asia|asia[\\s-]pacific|australia|sydney|melbourne|brisbane|perth|new zealand|auckland|wellington|japan|tokyo|osaka|kyoto|china|beijing|shanghai|shenzhen|hong kong|taiwan|taipei|south korea|korea|seoul|singapore|malaysia|kuala lumpur|indonesia|jakarta|thailand|bangkok|vietnam|hanoi|ho chi minh|philippines|manila|cebu|india|bangalore|bengaluru|mumbai|delhi|hyderabad|pune|chennai|kolkata|noida|gurgaon|gurugram|nagpur|bhubaneswar|ahmedabad|jaipur|indore|coimbatore|chandigarh|kochi|trivandrum|thiruvananthapuram|surat|lucknow|nashik|vadodara|mysore|mysuru|visakhapatnam|pakistan|karachi|lahore|bangladesh|dhaka|sri lanka|colombo|nepal|kathmandu";
const MIDDLE_EAST_CENTRAL_ASIA =
  "middle east|israel|tel aviv|jerusalem|uae|united arab emirates|dubai|abu dhabi|saudi|riyadh|jeddah|qatar|doha|kuwait|bahrain|oman|jordan|amman|lebanon|beirut|turkey|t(u|ü)rkiye|istanbul|ankara|armenia|yerevan|tbilisi|azerbaijan|baku|kazakhstan|almaty|uzbekistan|tashkent|iran|tehran|iraq|baghdad|syria|yemen|afghanistan|kabul|kyrgyzstan|tajikistan|turkmenistan";

const NON_AFRICA_RX = new RegExp(
  `\\b(${NORTH_AMERICA}|${LATIN_AMERICA}|${EUROPE}|${ASIA_PACIFIC}|${MIDDLE_EAST_CENTRAL_ASIA})\\b`,
  "i"
);

// "US" and "NA" are matched case-sensitively: lowercase "us" is the English
// pronoun and "na" is noise, and both show up in prose far more often than they
// do as a place. The rest are unambiguous enough to match either way.
const ABBREV_CASED_RX = /\b(US|U\.S\.?|NA|SF|LA|NYC|DC)\b/;
const ABBREV_RX = /\b(uk|eu|latam|apac|u\.?s\.?a)\b/i;

// "New York, NY" — a comma plus a two-letter state is a US posting even when the
// city is one we do not list. Requiring the comma keeps "OR", "IN" and "ME" from
// matching ordinary words.
const US_STATE_RX =
  /,\s*(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC)\b/;

// Timezone requirements are a geographic restriction by another name.
const TIMEZONE_RX =
  /\b(est|edt|pst|pdt|cst|cdt|mst|mdt|(eastern|pacific|central|mountain) time|utc[+-]\d|gmt[+-]\d)\b/i;
// Cased so the two-letter forms don't collide with ordinary words.
const TIMEZONE_CASED_RX = /\b(PT|ET|CT|MT)\b/;

// Tokens that carry no geographic commitment either way. A location is generic
// when *every* token in it is one of these, so "Remote · Remote" and
// "Homeoffice · Remote" resolve the same way a bare "Remote" does.
const GENERIC_TOKEN_RX =
  /^(all |fully |100% |completely |mostly |primarily )?(remote(ly)?( work| job| first| friendly)?|work from home|wfh|home ?office|hybrid|on[\s-]?site|anywhere|flexible|distributed|n\/?a|none|not stated|not specified|unspecified|tbd|various|multiple locations|any|-)$/i;

function isGenericLocation(loc) {
  // Whole-string first, so values that contain a separator as part of the token
  // itself ("N/A") are not shredded by the split below.
  if (GENERIC_TOKEN_RX.test(loc.trim())) return true;

  // Parentheses split too: "Remote (all remote)" is a restatement, not a place.
  // Anything that *is* a place has already been matched before we get here.
  const tokens = loc
    .split(/[·|,;/&()[\]]|[-–—]/)
    .map((t) => t.trim())
    .filter(Boolean);
  return tokens.length === 0 || tokens.every((t) => GENERIC_TOKEN_RX.test(t));
}

/**
 * Read a location field as one of:
 *   "open"       — states no limit, or names an area that contains Africa
 *   "closed"     — names an area that excludes Africa
 *   "none"       — says nothing geographic ("Remote", "Not stated")
 *   "unresolved" — names somewhere we have no rule for
 * Openness is checked first, so "EMEA, LATAM, Canada" reads as open: the
 * employer already said an African applicant is inside the stated area.
 */
function readGeography(text) {
  if (!text) return { verdict: "none" };
  if (AFRICA_RX.test(text)) return { verdict: "open", term: text.match(AFRICA_RX)[0] };
  if (WORLDWIDE_RX.test(text)) return { verdict: "open", term: text.match(WORLDWIDE_RX)[0] };

  const closedBy = [
    NON_AFRICA_RX,
    ABBREV_CASED_RX,
    ABBREV_RX,
    US_STATE_RX,
    TIMEZONE_RX,
    TIMEZONE_CASED_RX,
  ];
  for (const rx of closedBy) {
    const m = text.match(rx);
    if (m) return { verdict: "closed", term: m[0].replace(/^,\s*/, "") };
  }

  if (isGenericLocation(text)) return { verdict: "none" };

  // Some boards (HackerNews especially) put the whole ad in the location field.
  // A run of prose that long is not a place name, and quoting it back as
  // "based in <essay>" is worse than admitting we have no location at all.
  if (text.length > 90 || text.split(/\s+/).length > 12) return { verdict: "none" };

  return { verdict: "unresolved" };
}

// Descriptions are prose, so a bare place name in them means nothing — every ad
// names a city somewhere. Only explicit statements about who may apply count.
const DESC_OPEN_RX =
  /\b(anywhere in the world|from anywhere|work from anywhere|hire (globally|worldwide|from anywhere)|globally distributed|fully distributed|any country|regardless of (your )?location|no matter where you (are|live))\b/i;
const DESC_CLOSED_RX =
  /\b(must (be|reside|live|are) (based |located )?(in|within)|must be located|candidates must be|only (accepting|considering|open to) (candidates|applicants)|authoriz(ed|ation) to work in|eligible to work in|legally able to work in|no visa sponsorship|cannot (provide|offer) sponsorship|citizens? only|security clearance)\b/i;

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
  const geo = readGeography(loc);

  if (geo.verdict === "open") {
    signals.push(geo.term.toLowerCase());
    return { eligibility: "eligible", signals };
  }

  if (geo.verdict === "closed") {
    signals.push(`restricted: ${geo.term.toLowerCase()}`);
    // Relocation support softens a hard restriction, but doesn't clear it.
    return { eligibility: relocation ? "maybe" : "restricted", signals };
  }

  // Names a specific place we have no rule for (e.g. "Calmsden, Cirencester").
  // Boilerplate like "we're a global team" in the description is far too weak to
  // overturn that, and neither is relocation support: being flown somewhere is
  // not the same as being able to apply from here. So this caps at "worth a shot".
  if (geo.verdict === "unresolved") {
    signals.push(`based in ${loc.toLowerCase()}`);
    return { eligibility: "maybe", signals };
  }

  // Location is generic ("Remote"), so the description is all we have.
  if (DESC_OPEN_RX.test(descriptionText) || AFRICA_RX.test(descriptionText)) {
    signals.push("description opens it worldwide");
    return { eligibility: "eligible", signals };
  }
  if (DESC_CLOSED_RX.test(descriptionText)) {
    signals.push("description hints at a region restriction");
    return { eligibility: "maybe", signals };
  }
  return { eligibility: "maybe", signals };
}

/**
 * Sources hand us HTML in varying states of escaping, WeWorkRemotely's RSS
 * double-escapes it, so "&lt;p&gt;" arrives as literal text. Decode the angle
 * brackets first, then strip tags, then decode everything else. Doing it in any
 * other order leaves markup visible in the UI.
 */
/** Entity decoding, shared by the description cleaner and the title cleaner. */
function decodeEntities(s) {
  return s
    .replace(/&nbsp;/gi, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&(quot|ldquo|rdquo);/gi, '"')
    .replace(/&(apos|rsquo|lsquo);/gi, "'")
    .replace(/&(mdash|ndash);/gi, "-")
    .replace(/&amp;/gi, "&"); // last, so we don't re-decode our own output
}

/**
 * Titles arrive escaped from the RSS-backed sources, so "Checkout &amp; Link"
 * was rendering with the entity visible on the card. Decode, then strip any
 * markup that survived, since a title is one line of plain text by definition.
 */
function cleanTitle(raw = "") {
  return decodeEntities(String(raw).replace(/&lt;/gi, "<").replace(/&gt;/gi, ">"))
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanDescription(raw = "") {
  let s = String(raw).replace(/&lt;/gi, "<").replace(/&gt;/gi, ">");

  s = s
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li[^>]*>/gi, "\n• ")
    .replace(/<\/(p|div|h\d|ul|ol|tr|section)>/gi, "\n")
    .replace(/<[^>]+>/g, " ");

  s = decodeEntities(s);

  return s
    .replace(/[—–]/g, "-") // normalise scraped dashes to plain hyphens
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 4000);
}

/**
 * Sources repeat tags, sometimes in different casing ("Engineering" twice, or
 * "QA" and "qa"). The UI uses the tag as a React key, so duplicates make React
 * drop or double rows in the list. Strip them here, at the point the record is
 * built, rather than papering over it in the view.
 */
function dedupeTags(tags = []) {
  const seen = new Set();
  const out = [];
  for (const tag of tags) {
    const value = String(tag).trim();
    const key = value.toLowerCase();
    if (!value || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

/** Full pipeline for a raw normalized job → enriched job, or null if not relevant. */
export function processJob(raw) {
  const title = cleanTitle(raw.title);
  const role = classifyRole(title, raw.tags);
  if (!role) return null;
  const { eligibility, signals } = scoreEligibility(raw.locationText, raw.description);
  return {
    id: raw.id,
    source: raw.source,
    title,
    company: cleanTitle(raw.company) || "Unknown",
    url: raw.url,
    locationText: (raw.locationText || "Remote").replace(/[—–]/g, "-").trim(),
    salary: raw.salary || null,
    tags: dedupeTags(raw.tags).slice(0, 6),
    postedAt: raw.postedAt,
    // Only some sources publish a closing date; where they do, the store uses
    // it to retire the role instead of holding it for the full 30 days.
    expiresAt: Number.isFinite(raw.expiresAt) ? raw.expiresAt : null,
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
