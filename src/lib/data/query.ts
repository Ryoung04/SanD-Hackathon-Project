import { CATEGORIES, type Category } from './types';

export type QueryParse =
  | { ok: true; categories?: Category[]; limit: number }
  | { ok: false; code: 'INVALID_CATEGORY' | 'INVALID_LIMIT'; message: string };

export function parseQuery(categoriesRaw: string | null, limitRaw: string | null): QueryParse {
  let categories: Category[] | undefined;
  if (categoriesRaw) {
    const parts = categoriesRaw.split(',').map((s) => s.trim()).filter(Boolean);
    const bad = parts.filter((p) => !(CATEGORIES as readonly string[]).includes(p));
    if (bad.length) return { ok: false, code: 'INVALID_CATEGORY', message: `Unknown categories: ${bad.slice(0, 5).join(', ')}` };
    categories = parts as Category[];
  }
  let limit = 200;
  if (limitRaw !== null && limitRaw !== '') {
    if (!/^\d+$/.test(limitRaw) || Number(limitRaw) < 1 || Number(limitRaw) > 500)
      return { ok: false, code: 'INVALID_LIMIT', message: 'limit must be an integer 1..500' };
    limit = Number(limitRaw);
  }
  return { ok: true, categories, limit };
}
