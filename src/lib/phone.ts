// Phone + name normalisation used by the duplicate check (PRD A9)

/** strip +91, spaces, dashes, leading 0; keep last 10 digits. null if not a valid Indian mobile */
export function phoneKey(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 10) return null;
  const last10 = digits.slice(-10);
  // what's left before the last 10 must be a country code or trunk prefix
  const prefix = digits.slice(0, -10);
  if (prefix && !["91", "0", "091", "0091"].includes(prefix)) return null;
  return /^[6-9]\d{9}$/.test(last10) ? last10 : null;
}

export function formatPhone(key: string | null | undefined): string {
  if (!key) return "—";
  return `+91 ${key.slice(0, 5)} ${key.slice(5)}`;
}

export function maskPhone(key: string | null | undefined): string {
  if (!key) return "—";
  return `+91 ${key.slice(0, 2)}xxx x${key.slice(6)}`;
}

const HONORIFICS = /\b(mr|mrs|ms|miss|dr|shri|smt|sri|ji|bhai|ben|behen)\b\.?/g;

export function normaliseName(name: string | null | undefined): string {
  if (!name) return "";
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(HONORIFICS, " ")
    .replace(/[^\p{L}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const dp = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length];
}

/** same person by name? token order ignored, small typos allowed ("Hardik Patel" ~ "Patel Hardik" ~ "Hardik Patil") */
export function similarNames(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = normaliseName(a);
  const y = normaliseName(b);
  if (!x || !y) return false;
  const sx = x.split(" ").sort().join(" ");
  const sy = y.split(" ").sort().join(" ");
  if (sx === sy) return true;
  // single-token names are too weak to match on
  if (!x.includes(" ") || !y.includes(" ")) return false;
  const limit = Math.max(1, Math.floor(Math.min(sx.length, sy.length) / 8));
  return levenshtein(sx, sy) <= limit;
}

export function normaliseEmail(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const e = raw.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : null;
}
