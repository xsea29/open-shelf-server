/*
 * LibGen access for the Open Shelf server. Ported from libgen-downloader
 * (src/api/adapters/libgen-plus-adapter.ts, src/api/data/config.ts and
 * src/api/data/document.ts). Kept self-contained so this project does not depend
 * on the terminal app's layout; the terminal app's entry point starts its UI on import.
 */
import { parseHTML } from 'linkedom';

const CONFIGURATION_URL =
  'https://raw.githubusercontent.com/obsfx/libgen-downloader/configuration/config.v3.json';
const USER_AGENT = 'open-shelf/0.1.0';
const TIMEOUT_MS = 10_000;

/** Used only when the configuration file cannot be fetched. */
const FALLBACK_MIRRORS = ['https://libgen.gl/', 'https://libgen.bz/', 'https://libgen.la/'];

export interface LibgenItem {
  md5: string;
  title: string;
  authors: string;
  publisher: string;
  year: string;
  pages: string;
  language: string;
  size: string;
  extension: string;
}

let workingMirror: string | undefined;

async function fetchText(url: string | URL): Promise<string> {
  const response = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${url}`);
  return response.text();
}

async function candidateMirrors(): Promise<string[]> {
  if (process.env.LIBGEN_MIRROR) return [process.env.LIBGEN_MIRROR];
  try {
    const config = JSON.parse(await fetchText(CONFIGURATION_URL)) as {
      mirrors?: { src: string; type: string }[];
    };
    const mirrors = (config.mirrors ?? []).filter((m) => m.type === 'libgen-plus').map((m) => m.src);
    if (mirrors.length > 0) return mirrors;
  } catch {
    // Fall through to the built-in list.
  }
  return FALLBACK_MIRRORS;
}

/**
 * Runs `run` against the first mirror that works. The mirror that worked last is
 * tried first, so a healthy mirror is not re-probed on every request.
 */
export async function withMirror<T>(run: (base: string) => Promise<T>): Promise<T> {
  const mirrors = await candidateMirrors();
  const order = workingMirror ? [workingMirror, ...mirrors.filter((m) => m !== workingMirror)] : mirrors;
  const failures: string[] = [];

  for (const base of order) {
    try {
      const result = await run(base);
      workingMirror = base;
      return result;
    } catch (error) {
      failures.push(`${base}: ${(error as Error).message}`);
    }
  }
  throw new Error(`No LibGen mirror responded (${failures.join('; ')})`);
}

/** Parses the result table on a LibGen search page. Throws when the page has no table, so the caller can try another mirror. */
function parseRows(html: string): LibgenItem[] {
  const { document } = parseHTML(html);
  const alert = document.querySelector('.alert-danger');
  if (alert) throw new Error(alert.textContent?.trim() || 'LibGen reported an error');

  const body = document.querySelector('#tablelibgen > tbody');
  if (!body) {
    // A working mirror shows its search form but no table when nothing matched; a broken one has neither.
    if (document.querySelector('#formlibgen')) return [];
    throw new Error('not a LibGen search page');
  }

  const clean = (value: string | null | undefined) => (value ?? '').replace(/\s+/g, ' ').trim();
  const items: LibgenItem[] = [];

  for (const row of [...body.children]) {
    const cells = row.children;
    const md5 = row.querySelector('a[href*="md5="]')?.getAttribute('href')?.match(/md5=([0-9a-f]{32})/i)?.[1];
    if (!md5) continue;

    // The title cell holds the title plus extra links (series, edition); the links are dropped.
    const title = [...(cells[0]?.children ?? [])]
      .filter((child) => child.nodeName !== 'NOBR')
      .map((child) => clean(child.textContent))
      .filter(Boolean)
      .join(' / ');

    items.push({
      md5: md5.toLowerCase(),
      title,
      authors: clean(cells[1]?.textContent).split(';').map((a) => a.trim()).filter(Boolean).join(', '),
      publisher: clean(cells[2]?.textContent),
      year: clean(cells[3]?.textContent),
      language: clean(cells[4]?.textContent),
      pages: clean(cells[5]?.textContent),
      size: clean(cells[6]?.textContent),
      extension: clean(cells[7]?.textContent).toLowerCase(),
    });
  }

  return items;
}

/** LibGen answers in pages of this many rows (it accepts 25, 50 or 100 and rounds smaller values up). */
export const LIBGEN_PAGE_SIZE = 25;

const PAGE_CACHE_TTL_MS = 5 * 60_000;
const PAGE_CACHE_MAX = 100;
const pageCache = new Map<string, { at: number; rows: LibgenItem[] }>();

/** Fetches one LibGen result page (1-based). Recent pages are cached, since the app pages through a few rows at a time. */
export async function searchLibgen(query: string, page: number): Promise<LibgenItem[]> {
  const key = `${page}:${query}`;
  const cached = pageCache.get(key);
  if (cached && Date.now() - cached.at < PAGE_CACHE_TTL_MS) return cached.rows;

  const rows = await withMirror(async (base) => {
    const url = new URL('/index.php', base);
    url.searchParams.set('req', query);
    url.searchParams.set('page', String(page));
    url.searchParams.set('res', String(LIBGEN_PAGE_SIZE));
    // Books only (files in the main LibGen collection); the default view also lists journal articles.
    url.searchParams.append('objects[]', 'f');
    url.searchParams.append('topics[]', 'l');
    return parseRows(await fetchText(url));
  });

  pageCache.set(key, { at: Date.now(), rows });
  if (pageCache.size > PAGE_CACHE_MAX) {
    const oldest = pageCache.keys().next().value;
    if (oldest) pageCache.delete(oldest);
  }
  return rows;
}

/** Finds the direct download link on a LibGen detail page (`ads.php?md5=`). */
export function findDownloadUrl(md5: string): Promise<string> {
  return withMirror(async (base) => {
    const url = new URL('/ads.php', base);
    url.searchParams.set('md5', md5);
    const { document } = parseHTML(await fetchText(url));
    const link = document.querySelector('#main > tr:first-child > td:nth-child(2) > a')?.getAttribute('href');
    if (!link) throw new Error('download link not found on detail page');
    return new URL(link, base).toString();
  });
}
