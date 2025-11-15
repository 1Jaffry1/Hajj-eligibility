// sync-csvs.mjs
// Usage:
//   node sync-csvs.mjs          -> run persistent sync (default interval)
//   node sync-csvs.mjs --once  -> fetch once and exit
//
// This replaces your previous script and adds:
//  - immediate first fetch
//  - configurable poll interval (CSV_POLL_MS, default 5 minutes)
//  - conditional GETs using ETag / Last-Modified saved to disk
//  - minimal exponential backoff per-resource on repeated failures
//
// NOTE: This script *does not* try to detect field-level sheet edits in real-time.
// For near-real-time push from Google Sheets, use an Apps Script or a Pub/Sub webhook.

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const LOCAL_CSV_DIR = path.join(ROOT, 'csv');
const PUBLIC_CSV_DIR = path.join(ROOT, 'public', 'csv');
const META_PATH = path.join(PUBLIC_CSV_DIR, '.meta.json'); // stores ETag/Last-Modified per file

// Remote sheet URLs (keep in sync with App.jsx constants)
const REMOTES = {
  questions: process.env.QUESTIONS_URL || "https://docs.google.com/spreadsheets/d/e/2PACX-1vRLuujUXgZzVklkPRoYOZo8Kl_elpgbF-zf2DaHfUTXtMSOcsVkJBP8RDeAz0jGOZku3HAm5CFt-7gc/pub?gid=0&single=true&output=csv",
  phrases: process.env.PHRASES_URL || "https://docs.google.com/spreadsheets/d/e/2PACX-1vRLuujUXgZzVklkPRoYOZo8Kl_elpgbF-zf2DaHfUTXtMSOcsVkJBP8RDeAz0jGOZku3HAm5CFt-7gc/pub?gid=780232032&single=true&output=csv",
  rules: process.env.LOGIC_URL || "https://docs.google.com/spreadsheets/d/e/2PACX-1vRLuujUXgZzVklkPRoYOZo8Kl_elpgbF-zf2DaHfUTXtMSOcsVkJBP8RDeAz0jGOZku3HAm5CFt-7gc/pub?gid=1049243779&single=true&output=csv",
};

// How often to poll (ms). Default 5 minutes for reasonably frequent syncs.
// Set CSV_POLL_MS env var to override.
const DEFAULT_POLL_MS = 1000 * 10*60;
const POLL_MS = Number(process.env.CSV_POLL_MS || DEFAULT_POLL_MS);

// Backoff base (ms) for failing resources. On repeated failures it multiplies.
const BACKOFF_BASE_MS = 1000 * 10; // 10s
const BACKOFF_MAX_MS = 1000 * 60 * 30; // 30m

// internal metadata loaded/saved to disk. Structure:
// { "<name>": { etag: "...", lastModified: "...", failCount: 0, nextAttemptAt: 0 } }
let meta = {};

async function ensureDirs() {
  await fs.mkdir(PUBLIC_CSV_DIR, { recursive: true });
  await fs.mkdir(LOCAL_CSV_DIR, { recursive: true });
}

async function loadMeta() {
  try {
    const txt = await fs.readFile(META_PATH, 'utf8');
    meta = JSON.parse(txt);
  } catch (e) {
    meta = {};
  }
}

async function saveMeta() {
  try {
    await fs.writeFile(META_PATH, JSON.stringify(meta, null, 2), 'utf8');
  } catch (e) {
    console.warn('Failed to write meta file', e);
  }
}

// copy any local-only CSVs at startup (development convenience)
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

// Build headers used for conditional requests from saved meta
function buildConditionalHeaders(name) {
  const m = meta[name] || {};
  const headers = {};
  if (m.etag) headers['If-None-Match'] = m.etag;
  if (m.lastModified) headers['If-Modified-Since'] = m.lastModified;
  // Avoid caching on intermediate proxies — we want latest from Google.
  headers['Cache-Control'] = 'no-cache';
  return headers;
}

function markSuccess(name, resHeaders) {
  meta[name] = meta[name] || {};
  meta[name].etag = resHeaders.get('etag') || meta[name].etag || null;
  meta[name].lastModified = resHeaders.get('last-modified') || meta[name].lastModified || null;
  meta[name].failCount = 0;
  meta[name].nextAttemptAt = 0;
}

function markFailure(name) {
  meta[name] = meta[name] || {};
  meta[name].failCount = (meta[name].failCount || 0) + 1;
  const backoff = Math.min(BACKOFF_BASE_MS * Math.pow(2, meta[name].failCount - 1), BACKOFF_MAX_MS);
  meta[name].nextAttemptAt = Date.now() + backoff;
  console.warn(`Marked failure for ${name} (failCount=${meta[name].failCount}). nextAttemptAt=${new Date(meta[name].nextAttemptAt).toISOString()}`);
}

// fetch with conditional headers and only write on change.
// name: 'questions'|'phrases'|'rules'
async function fetchAndWrite(name, url) {
  try {
    const m = meta[name] || {};
    if (m.nextAttemptAt && Date.now() < m.nextAttemptAt) {
      // skip due to exponential backoff
      console.log(`${name}: skipping fetch due to backoff until ${new Date(m.nextAttemptAt).toISOString()}`);
      return;
    }

    const headers = buildConditionalHeaders(name);

    console.log(`${new Date().toISOString()} fetching ${name} from ${url}`);
    const res = await fetch(url, { method: 'GET', headers, redirect: 'follow' });

    if (res.status === 304) {
      // Not modified, nothing to do.
      console.log(`${name}: not modified (304).`);
      markSuccess(name, res.headers);
      await saveMeta();
      return;
    }

    if (!res.ok) {
      // Treat 200..299 as ok; otherwise mark failure and bail.
      const text = await res.text().catch(() => '');
      throw new Error(`fetch ${name} failed: ${res.status} ${res.statusText} ${text.slice(0, 200)}`);
    }

    // Got content; write to disk
    const txt = await res.text();

    const localPath = path.join(LOCAL_CSV_DIR, `${name}.csv`);
    const publicPath = path.join(PUBLIC_CSV_DIR, `${name}.csv`);

    // Optionally: compare to existing file content to avoid rewrite churn.
    let existing = null;
    try { existing = await fs.readFile(localPath, 'utf8'); } catch (e) { existing = null; }

    if (existing === txt) {
      console.log(`${name}: content unchanged (byte-equal).`);
      markSuccess(name, res.headers);
      await saveMeta();
      return;
    }

    // write both locations
    await fs.writeFile(localPath, txt, 'utf8');
    await fs.writeFile(publicPath, txt, 'utf8');
    markSuccess(name, res.headers);
    await saveMeta();
    console.log(`${name}: updated files written to csv/ and public/csv/`);
  } catch (e) {
    console.error(`${name}: update failed:`, e?.message || e);
    markFailure(name);
    await saveMeta();
  }
}

async function updateAll() {
  const tasks = Object.entries(REMOTES).map(([name, url]) => fetchAndWrite(name, url));
  await Promise.all(tasks);
}

async function main() {
  const once = process.argv.includes('--once');

  await ensureDirs();
  await loadMeta();
  await copyLocalToPublic();

  if (once) {
    console.log('Running one-time remote fetch -> local/public');
    await updateAll();
    console.log('Done.');
    process.exit(0);
  }

  // Immediate first fetch on start
  console.log('Starting CSV sync loop. Performing immediate fetch then scheduling periodic polling.');
  await updateAll();

  // Start polling loop
  console.log(`Polling every ${POLL_MS / 10} seconds (CSV_POLL_MS=${POLL_MS}). To change interval, set CSV_POLL_MS env var.`);
  setInterval(async () => {
    try {
      console.log(new Date().toISOString(), 'Scheduled update start');
      await updateAll();
    } catch (e) {
      console.error('Scheduled update error', e);
    }
  }, POLL_MS);
}

main().catch((e) => {
  console.error('Fatal sync error', e);
  process.exit(1);
});
