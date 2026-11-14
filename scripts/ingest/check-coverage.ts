import { countByKindCategory } from '../../src/lib/data/observations';

async function main() {
  const rows = await countByKindCategory();
  console.log('source_kind'.padEnd(18) + 'category'.padEnd(26) + 'count');
  let total = 0;
  for (const r of rows) { console.log(r.source_kind.padEnd(18) + r.category.padEnd(26) + r.n); total += r.n; }
  console.log('TOTAL'.padEnd(44) + total);
}
main();
