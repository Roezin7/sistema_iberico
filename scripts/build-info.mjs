import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
let revision = process.env.SOURCE_COMMIT || process.env.COMMIT_SHA || 'unknown';
if (revision === 'unknown') {
  try { revision = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim(); } catch {}
}
writeFileSync(new URL('../server/public/version.json', import.meta.url), JSON.stringify({ revision, built_at: new Date().toISOString() }));
