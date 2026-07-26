export const VERDICT = {
  eligible: { label: "Open worldwide", tone: "jade" },
  maybe: { label: "Policy unstated", tone: "copper" },
  restricted: { label: "Region-locked", tone: "crimson" },
};

// Mirrors the server taxonomy. Needed because CSS capitalize turns "ai-ml" into
// "Ai / Ml"; acronyms have to be spelled out, not transformed.
const ROLE_LABEL = {
  "ai-ml": "AI / ML",
  data: "Data",
  security: "Security",
  blockchain: "Blockchain / Web3",
  game: "Game Dev",
  embedded: "Embedded / IoT",
  mobile: "Mobile",
  devops: "DevOps / Cloud",
  qa: "QA / Test",
  fullstack: "Fullstack",
  frontend: "Frontend",
  backend: "Backend",
  leadership: "Lead / Manager",
  engineering: "General Software",
};

export const roleLabel = (key) => ROLE_LABEL[key] || key;

export function timeAgo(ts) {
  const mins = Math.max(1, Math.round((Date.now() - ts) / 60000));
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}
