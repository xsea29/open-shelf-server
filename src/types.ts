/*
 * The shape of what the API returns. The Open Shelf app has the same types in
 * src/data/types.ts; keep the two in step when either changes.
 */

export type CoverPattern = 0 | 1 | 2 | 3 | 4;

export interface BookCover {
  /** Base colour of the generated cover. */
  c1: string;
  /** Accent-shape colour of the generated cover. */
  c2: string;
  pattern: CoverPattern;
  imageUrl?: string;
}

export interface BookFormat {
  type: 'EPUB' | 'PDF';
  size: string;
  /** Absolute path under `/api` that answers `{ url }` with the direct file link. */
  url: string;
}

export interface Book {
  /** The LibGen md5 of the file. */
  id: string;
  title: string;
  author: string;
  year: number;
  pages: number;
  language: string;
  isbn: string;
  publisher: string;
  subjects: string[];
  description: string[];
  formats: BookFormat[];
  cover: BookCover;
}

export interface SearchResult {
  items: Book[];
  total: number;
}
