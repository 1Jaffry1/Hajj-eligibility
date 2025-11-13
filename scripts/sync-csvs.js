import fs from 'fs/promises'
import path from 'path'
import {fileURLToPath} from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const LOCAL_CSV_DIR = path.join(ROOT, 'csv');
const PUBLIC_CSV_DIR = path.join(ROOT, 'public', 'csv');

// Remote sheet URLs (keep in sync with App.jsx constants)
const REMOTES = {
  questions: process.env.QUESTIONS_URL || "https://docs.google.com/spreadsheets/d/e/2PACX-1vRLuujUXgZzVklkPRoYOZo8Kl_elpgbF-zf2DaHfUTXtMSOcsVkJBP8RDeAz0jGOZku3HAm5CFt-7gc/pub?gid=0&single=true&output=csv",
  phrases: process.env.PHRASES_URL || "https://docs.google.com/spreadsheets/d/e/2PACX-1vRLuujUXgZzVklkPRoYOZo8Kl_elpgbF-zf2DaHfUTXtMSOcsVkJBP8RDeAz0jGOZku3HAm5CFt-7gc/pub?gid=780232032&single=true&output=csv",
  rules: process.env.LOGIC_URL || "https://docs.google.com/spreadsheets/d/e/2PACX-1vRLuujUXgZzVklkPRoYOZo8Kl_elpgbF-zf2DaHfUTXtMSOcsVkJBP8RDeAz0jGOZku3HAm5CFt-7gc/pub?gid=1049243779&single=true&output=csv",
}

async function ensureDirs() {
  await fs.mkdir(PUBLIC_CSV_DIR, { recursive: true });
}

async function copyLocalToPublic() {
  try {
    const names = ['questions.csv', 'phrases.csv', 'rules.csv'];
    for (const name of names) {
      const src = path.join(LOCAL_CSV_DIR, name);
      const dst = path.join(PUBLIC_CSV_DIR, name);
      try {
        const data = await fs.readFile(src, 'utf8');
        await fs.writeFile(dst, data, 'utf8');
        console.log(`copied local ${name} -> public/csv/${name}`);
      } catch (e) {
        // no local file - ignore
      }
    }
  } catch (e) {
    console.error('copyLocalToPublic failed', e);
  }
}

async function fetchAndWrite(name, url) {
  try {
    console.log(`fetching ${name} from ${url}`);
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`fetch failed ${res.status}`);
    const txt = await res.text();
    // write to both csv/ and public/csv/
    const localPath = path.join(LOCAL_CSV_DIR, `${name}.csv`);
    const publicPath = path.join(PUBLIC_CSV_DIR, `${name}.csv`);
    await fs.mkdir(LOCAL_CSV_DIR, { recursive: true });
    await fs.writeFile(localPath, txt, 'utf8');
    await fs.writeFile(publicPath, txt, 'utf8');
    console.log(`updated ${name}.csv`);
  } catch (e) {
    console.error(`failed to update ${name}:`, e?.message || e);
  }
}

async function updateAll() {
  await Promise.all([
    fetchAndWrite('questions', REMOTES.questions),
    fetchAndWrite('phrases', REMOTES.phrases),
    fetchAndWrite('rules', REMOTES.rules),
  ]);
}

async function main() {
  const once = process.argv.includes('--once');
  await ensureDirs();
  await copyLocalToPublic();

  if (once) {
    console.log('Running one-time remote fetch -> local/public');
    await updateAll();
    console.log('Done.');
    process.exit(0);
  }

  // Schedule: every 2 hours (7200000 ms)
  const TWO_HOURS = 1000 * 60 * 60 * 2;
  console.log('Starting CSV sync loop: will fetch remote sheets every 2 hours and overwrite csv/ and public/csv/');
  // First wait two hours (per request). If you'd like immediate replace, run with --once or call updateAll() here.
  setInterval(async () => {
    console.log(new Date().toISOString(), 'Starting scheduled update');
    await updateAll();
  }, TWO_HOURS);
}

main().catch((e) => { console.error(e); process.exit(1); });
