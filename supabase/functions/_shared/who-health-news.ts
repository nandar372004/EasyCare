export const WHO_HEADLINES_URL = "https://www.who.int/news-room/headlines";
export const WHO_NEWS_CACHE_MS = 45 * 60 * 1000;
const WHO_HOSTS = new Set(["who.int", "www.who.int"]);
const WHO_ARTICLE_PATH = /^\/news\/item\/[a-z0-9-]+\/?$/i;

function plainText(value: unknown, maxLength = 240): string {
  if (typeof value !== "string") return "";
  const cleaned = value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&#(\d+);/g, (_match, code) => {
      try { return String.fromCodePoint(Number(code)); } catch { return ""; }
    })
    .replace(/&#x([\da-f]+);/gi, (_match, code) => {
      try { return String.fromCodePoint(parseInt(code, 16)); } catch { return ""; }
    })
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.slice(0, maxLength).trim();
}

export function normalizeWhoArticleUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value, WHO_HEADLINES_URL);
    if (url.protocol !== "https:" || !WHO_HOSTS.has(url.hostname.toLowerCase())) return null;
    if (!WHO_ARTICLE_PATH.test(url.pathname)) return null;
    return `https://www.who.int${url.pathname}`;
  } catch {
    return null;
  }
}

function publicationDate(path: string): string | null {
  const match = path.match(/\/news\/item\/(\d{2})-(\d{2})-(\d{4})-/i);
  if (!match) return null;
  const [, day, month, year] = match;
  const date = `${year}-${month}-${day}`;
  return Number.isFinite(Date.parse(`${date}T00:00:00Z`)) ? date : null;
}

export function normalizeWhoNewsItem(input: {
  title?: unknown;
  published_at?: unknown;
  summary?: unknown;
  article_url?: unknown;
}) {
  const article_url = normalizeWhoArticleUrl(input.article_url);
  const title = plainText(input.title, 180);
  if (!article_url || !title) return null;
  const inputDate = typeof input.published_at === "string" && Number.isFinite(Date.parse(input.published_at))
    ? new Date(input.published_at).toISOString()
    : publicationDate(new URL(article_url).pathname);
  return {
    title,
    source: "WHO",
    published_at: inputDate,
    summary: plainText(input.summary, 220),
    article_url,
  };
}

export function parseWhoHeadlines(html: string) {
  const safeHtml = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, " ");
  const items = new Map<string, ReturnType<typeof normalizeWhoNewsItem>>();
  const anchorPattern = /<a\b(?=[^>]*\bhref\s*=\s*["']([^"']+)["'])[^>]*>([\s\S]*?)<\/a\s*>/gi;
  for (const match of safeHtml.matchAll(anchorPattern)) {
    const article_url = normalizeWhoArticleUrl(match[1]);
    if (!article_url || items.has(article_url)) continue;
    const item = normalizeWhoNewsItem({
      article_url,
      title: match[2],
      published_at: publicationDate(new URL(article_url).pathname) ?? undefined,
    });
    if (item) items.set(article_url, item);
  }
  return [...items.values()]
    .sort((a, b) => (Date.parse(b?.published_at || "") || 0) - (Date.parse(a?.published_at || "") || 0))
    .slice(0, 3);
}

export function createWhoNewsLoader({
  fetchImpl = fetch,
  now = () => Date.now(),
  cacheMs = WHO_NEWS_CACHE_MS,
}: {
  fetchImpl?: typeof fetch;
  now?: () => number;
  cacheMs?: number;
} = {}) {
  let cache: { items: ReturnType<typeof parseWhoHeadlines>; expiresAt: number } | null = null;
  let inFlight: Promise<{ items: ReturnType<typeof parseWhoHeadlines>; cached: boolean; stale: boolean }> | null = null;

  return function loadWhoNews() {
    if (cache && cache.expiresAt > now()) return Promise.resolve({ items: cache.items, cached: true, stale: false });
    if (inFlight) return inFlight;
    inFlight = (async () => {
      try {
        const response = await fetchImpl(WHO_HEADLINES_URL, {
          headers: { Accept: "text/html", "Accept-Language": "en" },
          signal: AbortSignal.timeout(9000),
        });
        if (!response.ok) throw new Error("WHO news source unavailable");
        const html = await response.text();
        const items = parseWhoHeadlines(html);
        if (!items.length) throw new Error("WHO news response had no valid headlines");
        cache = { items, expiresAt: now() + cacheMs };
        return { items, cached: false, stale: false };
      } catch {
        if (cache) return { items: cache.items, cached: true, stale: true };
        throw new Error("Health news is temporarily unavailable.");
      } finally {
        inFlight = null;
      }
    })();
    return inFlight;
  };
}
