import 'server-only';
import { neon } from '@neondatabase/serverless';

export type Sql = ReturnType<typeof neon>;

/** Returns a Neon query function, or null when DATABASE_URL is unset. Never logs the URL. */
export function getSql(): Sql | null {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  // no-store: stop Next.js's fetch data cache from serving stale query results.
  return neon(url, { fetchOptions: { cache: 'no-store' } });
}
