import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { findDownloadUrl, LIBGEN_PAGE_SIZE, searchLibgen } from './libgen.js';
import type { LibgenItem } from './libgen.js';
import type { Book, BookFormat, SearchResult } from './types.js';

/*
 * Serves the Open Shelf API from LibGen. The app reaches it under `/api`: through the
 * Vite proxy in development, and at this server's public address in a phone build.
 */

const PORT = Number(process.env.PORT ?? 8787);
const MAX_PAGE_SIZE = 25;
const MAX_REMEMBERED_BOOKS = 500;
const MD5 = /^[0-9a-f]{32}$/;

const PALETTE: [string, string][] = [
  ['#7A2E4D', '#D9A441'],
  ['#1F3B3A', '#5FA39A'],
  ['#2C3E6B', '#E08E45'],
  ['#4A3A2A', '#C9B38A'],
  ['#3D5A2E', '#A7C56B'],
];

// Books seen in search results, so the detail route can answer without asking LibGen again.
const remembered = new Map<string, Book>();

function remember(book: Book) {
  remembered.delete(book.id);
  remembered.set(book.id, book);
  if (remembered.size > MAX_REMEMBERED_BOOKS) {
    const oldest = remembered.keys().next().value;
    if (oldest) remembered.delete(oldest);
  }
}

/** LibGen's list view has no ISBN, description or subjects, so those get placeholders. */
function toBook(item: LibgenItem): Book | undefined {
  const formats: BookFormat[] = [];
  if (item.extension === 'epub') formats.push({ type: 'EPUB', size: item.size, url: `/api/books/${item.md5}/download` });
  if (item.extension === 'pdf') formats.push({ type: 'PDF', size: item.size, url: `/api/books/${item.md5}/download` });
  // The app only offers EPUB and PDF, so other formats are left out of results.
  if (formats.length === 0) return undefined;

  const [c1, c2] = PALETTE[parseInt(item.md5.slice(0, 2), 16) % PALETTE.length];
  return {
    id: item.md5,
    title: item.title || 'Untitled',
    author: item.authors || 'Unknown author',
    year: parseInt(item.year, 10) || 0,
    pages: parseInt(item.pages, 10) || 0,
    language: item.language || '',
    isbn: '',
    publisher: item.publisher || '',
    subjects: [],
    description: ['No description is available for this book on LibGen.'],
    formats,
    cover: { c1, c2, pattern: (parseInt(item.md5.slice(2, 4), 16) % 5) as Book['cover']['pattern'] },
  };
}

async function handleSearch(url: URL): Promise<SearchResult & { hasMore: boolean }> {
  const query = (url.searchParams.get('q') ?? '').trim();
  const page = Math.max(1, Number(url.searchParams.get('page') ?? 1) || 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(url.searchParams.get('pageSize') ?? 25) || 25));
  if (!query) return { items: [], total: 0, hasMore: false };

  // The app's pages are smaller than LibGen's, so cut this page out of LibGen's rows.
  // The window can straddle two LibGen pages.
  const start = (page - 1) * pageSize;
  const firstLibgenPage = Math.floor(start / LIBGEN_PAGE_SIZE) + 1;
  const offset = start % LIBGEN_PAGE_SIZE;

  let rows = await searchLibgen(query, firstLibgenPage);
  let lastPageFull = rows.length === LIBGEN_PAGE_SIZE;
  if (offset + pageSize > LIBGEN_PAGE_SIZE && lastPageFull) {
    const next = await searchLibgen(query, firstLibgenPage + 1);
    rows = rows.concat(next);
    lastPageFull = next.length === LIBGEN_PAGE_SIZE;
  }

  const slice = rows.slice(offset, offset + pageSize);
  const items = slice.map(toBook).filter((book): book is Book => book !== undefined);
  items.forEach(remember);

  // LibGen's list view does not report a total, so the total is estimated: while more
  // rows exist the total is one more than what has been seen.
  const hasMore = rows.length > offset + pageSize || lastPageFull;
  const total = start + slice.length + (hasMore ? 1 : 0);
  return { items, total, hasMore };
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(JSON.stringify(body));
}

async function route(req: IncomingMessage, res: ServerResponse) {
  if (req.method === 'OPTIONS') return send(res, 204, null);
  if (req.method !== 'GET') return send(res, 405, { error: 'Method not allowed' });

  const url = new URL(req.url ?? '/', 'http://localhost');

  // For the health checks that hosting platforms run.
  if (url.pathname === '/health') return send(res, 200, { ok: true });

  if (url.pathname === '/api/search') {
    return send(res, 200, await handleSearch(url));
  }

  const detail = url.pathname.match(/^\/api\/books\/([^/]+)$/);
  if (detail) {
    const book = remembered.get(detail[1]);
    return book ? send(res, 200, book) : send(res, 404, { error: 'Book not found. Search for it again.' });
  }

  const download = url.pathname.match(/^\/api\/books\/([^/]+)\/download$/);
  if (download) {
    const md5 = download[1].toLowerCase();
    if (!MD5.test(md5)) return send(res, 400, { error: 'Invalid book id' });
    return send(res, 200, { url: await findDownloadUrl(md5) });
  }

  return send(res, 404, { error: 'Not found' });
}

const server = createServer((req, res) => {
  route(req, res).catch((error: Error) => {
    console.error(error.message);
    send(res, 502, { error: error.message });
  });
});

server.listen(PORT, () => {
  console.log(`Open Shelf API listening on port ${PORT}`);
});
