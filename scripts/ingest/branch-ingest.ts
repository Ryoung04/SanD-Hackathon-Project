import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { neon } from '@neondatabase/serverless';

export const KINDS = ['city_gis', 'traffic_control', 'city_311'] as const;

export interface BranchStats {
  runs: Record<string, { status: string; normalized: number | null } | undefined>;
  current: Record<string, number | undefined>;
}

/** Pure validation: every source's latest run is ok with normalized > 0 and current count >= 50% of main. */
export function validateBranchCounts(main: Record<string, number | undefined>, branch: BranchStats): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];
  for (const k of KINDS) {
    const r = branch.runs[k];
    if (!r) reasons.push(`${k}: no ingest run recorded`);
    else if (r.status !== 'ok') reasons.push(`${k}: latest run status is ${r.status}`);
    else if (!(r.normalized && r.normalized > 0)) reasons.push(`${k}: normalized 0 records`);
    const m = main[k] ?? 0;
    const b = branch.current[k] ?? 0;
    if (m > 0 && b < m * 0.5) reasons.push(`${k}: current count ${b} is below 50% of main (${m})`);
  }
  return { ok: reasons.length === 0, reasons };
}

const redact = (s: string) => s.replace(/postgres(ql)?:\/\/\S+/gi, '[redacted]');

function neonCli(args: string[], capture = false): { code: number; out: string } {
  const r = spawnSync('npx', ['-y', 'neon@latest', ...args], { encoding: 'utf8' });
  const text = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  if (!capture) { const t = redact(text).trim(); if (t) console.log(t.split('\n').slice(-6).join('\n')); }
  return { code: r.status ?? 1, out: capture ? (r.stdout ?? '').trim() : redact(text) };
}

async function stats(url: string, branchName: string) {
  const sql = neon(url);
  const runs: BranchStats['runs'] = {};
  const rr = (await sql(`SELECT DISTINCT ON (source_kind) source_kind, status, normalized FROM ingest_runs WHERE neon_branch = $1 ORDER BY source_kind, started_at DESC`, [branchName])) as any[];
  for (const r of rr) runs[r.source_kind] = { status: r.status, normalized: r.normalized };
  const current: BranchStats['current'] = {};
  const cc = (await sql(`SELECT source_kind, COUNT(*)::int AS n FROM barrier_observations WHERE verification_status <> 'outdated' GROUP BY 1`)) as any[];
  for (const r of cc) current[r.source_kind] = r.n;
  return { runs, current };
}

async function main() {
  const project = JSON.parse(fs.readFileSync('.neon', 'utf8')).projectId as string;
  const mainUrl = process.env.DATABASE_URL;
  if (!mainUrl) throw new Error('DATABASE_URL not set');
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const name = `ingest-${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
  const base = ['branches', 'create', '--project-id', project, '--name', name, '--parent', 'main'];
  let c = neonCli([...base, '--expires-at', new Date(d.getTime() + 86400000).toISOString()]);
  if (c.code !== 0) c = neonCli(base);
  if (c.code !== 0) throw new Error('could not create ingest branch');
  const del = () => neonCli(['branches', 'delete', name, '--project-id', project]);
  try {
    const cs = neonCli(['connection-string', name, '--project-id', project, '--pooled'], true);
    if (cs.code !== 0 || !cs.out) throw new Error('could not get branch connection string');
    const branchUrl = cs.out.split('\n').pop() as string;
    const run = spawnSync('npx', ['tsx', '--env-file-if-exists=.env.local', '--conditions=react-server', 'scripts/ingest/run-all.ts'], {
      encoding: 'utf8', env: { ...process.env, DATABASE_URL: branchUrl, NEON_INGEST_BRANCH: name },
    });
    console.log(redact(run.stdout ?? '').trim());
    if (run.stderr) console.error(redact(run.stderr).trim().slice(0, 600));

    const [mainStats, br] = await Promise.all([stats(mainUrl, 'main'), stats(branchUrl, name)]);
    console.log('source'.padEnd(18) + 'run'.padEnd(10) + 'normalized'.padEnd(12) + 'main'.padEnd(8) + 'branch');
    for (const k of KINDS) console.log(k.padEnd(18) + String(br.runs[k]?.status ?? '-').padEnd(10) + String(br.runs[k]?.normalized ?? '-').padEnd(12) + String(mainStats.current[k] ?? 0).padEnd(8) + (br.current[k] ?? 0));
    const v = validateBranchCounts(mainStats.current, br);
    if (!v.ok) {
      del();
      console.error('NOT promoted; main untouched. Reasons:\n - ' + v.reasons.join('\n - '));
      process.exit(1);
    }
    const rs = neonCli(['branches', 'restore', 'main', name, '--project-id', project, '--preserve-under-name', `main-before-${name}`]);
    if (rs.code !== 0) throw new Error('restore failed; main may be untouched');
    // The backup branch is a child of the ingest branch, so it cannot be deleted; it auto-expires (--expires-at).
    console.log(`promoted (backup branch main-before-${name}; ${name} expires on its own)`);
  } catch (e) {
    del();
    console.error(`NOT promoted: ${redact((e as Error).message)}`);
    process.exit(1);
  }
}
if (!process.env.VITEST) main();
