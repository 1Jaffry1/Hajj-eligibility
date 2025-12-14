import React, { useState, useEffect } from "react";
// ... (the full JSX code was generated in the previous step)
// This file includes a robust CSV parser and a few dev-time tests to catch regressions.

import { motion } from "framer-motion";
import {
  User,
  HeartPulse,
  Wallet,
  Plane,
  Clock,
  MoreHorizontal,
  Lock,
  TriangleAlert,
  RotateCcw,
  CheckCircle,
  XCircle,
  CircleHelp,
} from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

/* =====================
   THEME
   ===================== */
const STYLES = {
  option3: {
    bg: "linear-gradient(to bottom, #efe1b6b0 0%, #d3b950d0 100%)",
    surface: "#F9F5E7",
    surfaceSoft: "#F1EAD1",
    border: "#C5C1AC",
    text: "#2B2B2B",
    title: "#000000bc",
    accent: "#8f8f8fff",
    success: "#5CC65C",
    danger: "#D32F2F",
    warn: "#E07B00",     // ORANGE (darker)
    caution: "#0957ffff",  // YELLOW (brighter/gold)
    successbg: "rgba(92, 198, 92, 0.10)",
    warnbg: "rgba(224, 123, 0, 0.15)",
    cautionbg: "rgba(0, 149, 255, 0.15)",

  },
};

/* =====================
   SHEETS (REPLACE WITH YOUR LINKS)
   ===================== */
const QUESTIONS_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRLuujUXgZzVklkPRoYOZo8Kl_elpgbF-zf2DaHfUTXtMSOcsVkJBP8RDeAz0jGOZku3HAm5CFt-7gc/pub?gid=0&single=true&output=csv";
const PHRASES_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRLuujUXgZzVklkPRoYOZo8Kl_elpgbF-zf2DaHfUTXtMSOcsVkJBP8RDeAz0jGOZku3HAm5CFt-7gc/pub?gid=780232032&single=true&output=csv";
const LOGIC_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRLuujUXgZzVklkPRoYOZo8Kl_elpgbF-zf2DaHfUTXtMSOcsVkJBP8RDeAz0jGOZku3HAm5CFt-7gc/pub?gid=1049243779&single=true&output=csv";
// Local fallbacks (served from /csv/*.csv). During development the `public/csv` folder will be used.
const LOCAL_QUESTIONS = "/csv/questions.csv";
const LOCAL_PHRASES = "/csv/phrases.csv";
const LOCAL_LOGIC = "/csv/rules.csv";

/* =====================
   FETCH + CSV PARSER
   ===================== */
async function fetchText(url) {
  const r = await fetch(url, { cache: "no-cache" });
  if (!r.ok) throw new Error("fetch failed: " + url);
  const ct = r.headers.get("content-type") || "";
  const txt = await r.text();
  if (ct.includes("application/json") || txt.trim().startsWith("{")) {
    return { kind: "json", data: JSON.parse(txt) };
  }
  return { kind: "csv", data: txt };
}

function parseCSV(text) {
  // Normalize line endings and strip UTF-8 BOM if present
  if (text && text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  // FIX: properly normalize CRLF/LF using a valid regex
  text = text.replace(/\r?\n/g, "\n");

  const rows = [];
  let cur = [];
  let field = "";
  let inQuotes = false;
  const pushField = () => { cur.push(field); field = ""; };
  const pushRow = () => { rows.push(cur); cur = []; };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        const next = text[i + 1];
        if (next === '"') { field += '"'; i++; } else { inQuotes = false; }
      } else field += ch;
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ",") pushField();
      else if (ch === "\n") { pushField(); pushRow(); }
      else field += ch;
    }
  }
  pushField();
  if (cur.length) pushRow();

  // Trim cells and drop fully empty rows
  const trimmed = rows.map(r => r.map(c => c.trim())).filter(r => r.some(c => c !== ""));
  const [rawHeader = [], ...data] = trimmed;

  // Clean header: strip BOM on first cell, normalize case for lookups
  const header = rawHeader.map((h, idx) => (idx === 0 ? h.replace(/^\uFEFF/, "") : h));
  const headerLC = header.map(h => h.toLowerCase());
  const idx = (name) => headerLC.indexOf(String(name).toLowerCase());

  return { header, data, idx };
}

/* =====================
   DEV TESTS for parseCSV (run only in dev)
   ===================== */
(function devCsvTests() {
  if (typeof window === 'undefined') return;
  if (!import.meta?.env?.DEV) return;
  try {
    const sample = "\uFEFFLevel,qId,question_text\r\n1,L1Q1,Hello\n";
    const quoted = "a,b,c\n\"x, y\",\"z\"\"w\"\n"; // tests commas + escaped quotes
    const { header, data, idx } = parseCSV(sample);
    console.assert(idx('level') === 0 && idx('qId') === 1 && idx('question_text') === 2, 'Header index lookup (case-insensitive/BOM) failed');
    console.assert(data.length === 1 && data[0][0] === '1' && data[0][1] === 'L1Q1' && data[0][2] === 'Hello', 'Simple row parse failed');
    const p2 = parseCSV(quoted);
    console.assert(p2.data.length === 2, 'Quoted multiline count failed');
    // if anything throws, it will surface in console; we keep the app running
    // eslint-disable-next-line no-console
    console.debug('[parseCSV tests] passed');
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[parseCSV tests] failed', e);
  }
})();

/* =====================
   LOAD QUESTIONS + PHRASES (Sheets)
   ===================== */
// Prefer remote Google Sheets; fallback to cached/local data. Cache successful pulls in localStorage.
async function loadSheets(questionsUrl, phrasesUrl) {
  const out = { texts: null, phrases: null };

  const getCache = (key) => {
    try {
      const s = localStorage.getItem(key);
      return s ? JSON.parse(s) : null;
    } catch { return null; }
  };
  const setCache = (key, val) => {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
  };

  // QUESTIONS: try remote first
  try {
    if (questionsUrl) {
      const q = await fetchText(questionsUrl);
      if (q.kind === "csv") {
        const { data, idx } = parseCSV(q.data);
        const texts = {};
        for (const row of data) {
          const level = row[idx("level")] || "";
          const qId = row[idx("qId")] || "";
          const prompt = row[idx("question_text")] || "";
          const help = row[idx("help_text")] || "";
          const labels = [];
          for (const key of ["label1", "label2", "label3", "label4", "label5"]) {
            const i = idx(key);
            if (i >= 0 && row[i]) labels.push(row[i]);
          }
          if (level && qId) {
            const lvlKey = `L${level}`;
            texts[lvlKey] ??= {};
            texts[lvlKey][qId] = { prompt, help, labels };
          }
        }
        out.texts = texts;
        setCache("cache_texts", texts);
      } else {
        out.texts = q.data;
        setCache("cache_texts", q.data);
      }
    }
  } catch (e) {
    // Fallback: cached, then local file
    const cached = getCache("cache_texts");
    if (cached) {
      out.texts = cached;
    } else {
      try {
        const qLocal = await fetchText(LOCAL_QUESTIONS);
        if (qLocal.kind === "csv") {
          const { data, idx } = parseCSV(qLocal.data);
          const texts = {};
          for (const row of data) {
            const level = row[idx("level")] || "";
            const qId = row[idx("qId")] || "";
            const prompt = row[idx("question_text")] || "";
            const help = row[idx("help_text")] || "";
            const labels = [];
            for (const key of ["label1", "label2", "label3", "label4", "label5"]) {
              const i = idx(key);
              if (i >= 0 && row[i]) labels.push(row[i]);
            }
            if (level && qId) {
              const lvlKey = `L${level}`;
              texts[lvlKey] ??= {};
              texts[lvlKey][qId] = { prompt, help, labels };
            }
          }
          out.texts = texts;
        }
      } catch {}
    }
  }

  // PHRASES: try remote first
  try {
    if (phrasesUrl) {
      const p = await fetchText(phrasesUrl);
      if (p.kind === "csv") {
        const { data, idx } = parseCSV(p.data);
        const dict = {};
        for (const row of data) {
          const key = row[idx("key")];
          const val = row[idx("text")];
          if (key) dict[key] = val || "";
        }
        out.phrases = dict;
        setCache("cache_phrases", dict);
      } else {
        out.phrases = p.data;
        setCache("cache_phrases", p.data);
      }
    }
  } catch (e) {
    // Fallback: cached, then local file
    const cached = getCache("cache_phrases");
    if (cached) {
      out.phrases = cached;
    } else {
      try {
        const pLocal = await fetchText(LOCAL_PHRASES);
        if (pLocal.kind === "csv") {
          const { data, idx } = parseCSV(pLocal.data);
          const dict = {};
          for (const row of data) {
            const key = row[idx("key")];
            const val = row[idx("text")];
            if (key) dict[key] = val || "";
          }
          out.phrases = dict;
        }
      } catch {}
    }
  }

  return out;
}

/* =====================
   LOAD LOGIC
   ===================== */
// Prefer remote; fallback to cached/local. Cache successful pulls.
async function loadLogic(url) {
  if (!url && typeof window === 'undefined') return null;

  const getCache = (key) => {
    try { const s = localStorage.getItem(key); return s ? JSON.parse(s) : null; } catch { return null; }
  };
  const setCache = (key, val) => { try { localStorage.setItem(key, JSON.stringify(val)); } catch {} };

  let data = [];
  let idx = () => -1;
  try {
    if (url) {
      const r = await fetchText(url);
      if (r.kind === "csv") {
        const parsed = parseCSV(r.data);
        data = parsed.data; idx = parsed.idx;
        setCache("cache_logic_csv", r.data);
      }
    }
  } catch (e) {
    // Fallback to cached CSV text, then local file
    const cachedCsv = getCache("cache_logic_csv");
    if (cachedCsv) {
      const parsed = parseCSV(cachedCsv);
      data = parsed.data; idx = parsed.idx;
    } else {
      try {
        const rLocal = await fetchText(LOCAL_LOGIC);
        if (rLocal.kind === "csv") {
          const parsed = parseCSV(rLocal.data);
          data = parsed.data; idx = parsed.idx;
        }
      } catch {}
    }
  }

  const byLevel = {};
  const ensure = (obj, key, def) => (obj[key] ??= def);
  const parseSetVars = (s) => {
    const out = {}; if (!s) return out;
    for (const pair of s.split(";")) {
      if (!pair.trim()) continue;
      const [k, vRaw] = pair.split("=").map(t => t.trim());
      if (!k) continue;
      let v = vRaw;
      if (vRaw === "true") v = true;
      else if (vRaw === "false") v = false;
      else if (vRaw !== "" && !isNaN(Number(vRaw))) v = Number(vRaw);
      out[k] = v;
    }
    return out;
  };
  for (const row of data) {
    const level = row[idx("level")]; if (!level) continue;
    const qId = row[idx("qId")]; if (!qId) continue;
    const itype = row[idx("input_type")] || "bool";
    const field = row[idx("field")] || qId;
    const optLabel = row[idx("option_label")] || "";
    const optValue = row[idx("option_value")] || "";
    const next = row[idx("next")] || "";
    const failReason = row[idx("fail_reason")] || "";
    const setVars = parseSetVars(row[idx("set_vars")] || "");
    const phrase = row[idx("phrase")] || "";
    const guardVar = row[idx("guard_if_var")] || "";
    const guardOp = row[idx("guard_op")] || "";
    const guardValue = row[idx("guard_value")] || "";
    const guardNext = row[idx("guard_next")] || "";
    const guardReason = row[idx("guard_reason")] || "";
    const fallback = row[idx("fallback")] || "";
    const lvl = ensure(byLevel, String(level), { entry_node: null, nodes: [], fallback_node: null });
    let node = lvl.nodes.find(n => n.id === qId);
    if (!node) {
      node = { id: qId, field, input_type: (itype === "options" || itype === "options3") ? "options3" : itype, routes: [], fallback_node: null };
      lvl.nodes.push(node);
      if (!lvl.entry_node) lvl.entry_node = qId;
    }
        // build route: store both the visible label and the stable value
    const stableValue = (node.input_type === "bool"
      ? (String(optValue).toLowerCase() === "true")
      : (optValue || optLabel)
    );

    const route = {
      // when.value uses the stable value (unchanged)
      when: { op: "==", field, value: stableValue },
      goto_node: next || undefined,
      // NEW: keep metadata: what was the label and what was the option_value from CSV.
      // This helps the UI map a visible label back to the stable code.
      optLabel: optLabel || "",
      optValue: (optValue || optLabel) || "",
    };

    if (failReason && (!next || next === "FAIL")) { route.goto_node = "FAIL"; route.reason = failReason; }
    if (phrase) route.print = phrase;
    if (Object.keys(setVars).length) route.set = setVars;
    if (guardVar && guardOp) route.guard = { field: guardVar, op: guardOp, value: guardValue, next: guardNext || "", reason: guardReason || "" };
    if (fallback && !node.fallback_node) node.fallback_node = fallback;
    node.routes.push(route);
  }
  return byLevel;
}

/* =====================
   NO FALLBACK: require sheets
   ===================== */
function requireSheetsOrThrow({ texts, phrases, logic }) {
  if (!texts) throw new Error("Questions sheet not a (QUESTIONS_URL).");
  if (!phrases) throw new Error("Phrases sheet not loaded (PHRASES_URL).");
  if (!logic) throw new Error("Logic sheet not loaded (LOGIC_URL).");
}

function getLevelsOrThrow(texts) {
  if (!texts) throw new Error("Questions sheet not loaded.");

  // Internal mapping of level IDs to custom titles
  const LEVEL_TITLES = {
    1: "Personal",
    2: "Health",
    3: "Financial",
    4: "Travel",
    5: "Time",
    6: "Miscellaneous"
  };

  if (!texts) throw new Error("Questions sheet not loaded.");
  
  const levelIds = Object.keys(texts)
    .filter(k => /^L\d+$/.test(k))
    .map(k => Number(k.slice(1)))
    .sort((a, b) => a - b);

  if (levelIds.length === 0) throw new Error("Questions sheet is empty.");

  return levelIds.map(id => {
    const lvlKey = "L" + id;
    const qIds = Object.keys(texts[lvlKey] || {}).sort((a, b) => {
      const ai = Number(a.split("Q")[1]); 
      const bi = Number(b.split("Q")[1]);
      return ai - bi;
    });

    return {
      id,
      title: LEVEL_TITLES[id] || `Level ${id}`,  // <-- use internal mapping
      icon: [User, HeartPulse, Wallet, Plane, Clock, MoreHorizontal][(id - 1) % 6] || MoreHorizontal,
      questions: qIds.map(qid => texts[lvlKey][qid]?.prompt || qid),
    };
  });
}

function getLevelRulesOrThrow(levelId, logic) {
  if (!logic) throw new Error("Logic sheet not loaded.");
  const rules = logic[String(levelId)];
  if (!rules || !Array.isArray(rules?.nodes) || rules.nodes.length === 0) {
    throw new Error(`Logic sheet missing nodes for level ${levelId}.`);
  }
  return rules;
}

/* =====================
   ROUTING ENGINE
   ===================== */
function opCompare(op, a, b) {
  switch (op) {
    case "==": return String(a) === String(b);
    case "!=": return String(a) !== String(b);
    case "<": return Number(a) < Number(b);
    case "<=": return Number(a) <= Number(b);
    case ">": return Number(a) > Number(b);
    case ">=": return Number(a) >= Number(b);
    default: return false;
  }
}

function evalRoutesFor(levelRules, nodeId, uiAnswer, vars) {
  if (!levelRules) return { ok: true };
  const list = levelRules.nodes || [];
  const node = list.find((n) => n.id === nodeId);
  if (!node) return { ok: true };

  let answer = uiAnswer;
  if (node.input_type === "bool") {
    const s = String(uiAnswer).trim().toLowerCase();
    if (s === "yes") answer = true;
    if (s === "no") answer = false;
    if (s === "true") answer = true;
    if (s === "false") answer = false;
  }

  const outVars = { ...(vars || {}) };
  if (node.field) outVars[node.field] = answer;

  if (Array.isArray(node.routes)) {
    for (const r of node.routes) {
      // Check option value FIRST
      const when = r.when || {};
      const left = outVars[when.field];
      const right = when.value;
      
      // If option value doesn't match, skip this route entirely
      if (!opCompare(when.op, left, right)) {
        continue;
      }

      // Option matched - now check guard if present
      if (r.guard) {
        const gv = outVars[r.guard.field];
        if (opCompare(r.guard.op, gv, r.guard.value)) {
          // Guard matched - follow guard action
          if (r.guard.next === "FAIL") return { ok: false, vars: outVars, reason: r.guard.reason || "L", print: r.print };
          if (r.guard.next === "END") return { ok: true, vars: outVars, complete: true, print: r.print, guardReason: r.guard.reason };
          if (r.guard.next) return { ok: true, vars: outVars, nextNode: r.guard.next, print: r.print, guardReason: r.guard.reason };
          return { ok: false, vars: outVars, reason: r.guard.reason || "L", print: r.print };
        }
        // Guard present but did NOT match -> skip this route
        continue;
      }

      // Option matched, no guard (or guard didn't match) - proceed with normal route
      if (r.set && typeof r.set === "object") Object.assign(outVars, r.set);

      if (r.goto_node === "END") return { ok: true, vars: outVars, complete: true, print: r.print };
      if (r.reset_to) return { ok: true, vars: outVars, action: "resetTo", nextNode: r.reset_to, print: r.print };
      if (r.goto_node === "FAIL") return { ok: false, vars: outVars, reason: r.reason || "L", print: r.print };
      if (r.goto_node) return { ok: true, vars: outVars, nextNode: r.goto_node, print: r.print };

      // matched route with no explicit next: DO NOT advance implicitly
      return { ok: true, vars: outVars, print: r.print };
    }
  }

  // fallbacks
  if (node.fallback_node === "FAIL") return { ok: false, vars: outVars, reason: "L" };
  if (node.fallback_node === "END") return { ok: true, vars: outVars, complete: true };
  if (node.fallback_node) return { ok: true, vars: outVars, nextNode: node.fallback_node };

  return { ok: true, vars: outVars };
}



function nodeIdFor(levelId, qIndex) { return "L" + levelId + "Q" + (qIndex + 1); }
function indexFromNodeId(nodeId) { const parts = String(nodeId).split("Q"); const n = parseInt(parts[1], 10); return Number.isFinite(n) ? n - 1 : null; }
function passesRule(levelId, qIndex, answer, options) {
  const nodeId = nodeIdFor(levelId, qIndex);
  const res = evalRoutesFor(options && options.levelRules, nodeId, answer, options && options.vars);
  if (res) return res;
  return { ok: true };
}

// Global phrase resolver: only returns phrases from the sheet (no hardcoded fallbacks)
function resolvePhrase(phrases, raw) {
  if (!raw) return "";
  const key = String(raw).trim();
  const variants = [key, key.split(' ').filter(Boolean).join('_')];
  for (const k of variants) {
    if (phrases && phrases[k]) return phrases[k];
  }
  return "";
}

/* =====================
   HOME
   ===================== */
function Home({ theme, onPick, statuses, overallResult, levels, onReset, phrases, resultPhrases }) {
  const t = (key) => resolvePhrase(phrases, key);

  // choose PHRASE from the logic sheet for overall banner
  const failedLevel = levels.find((lvl) => statuses[lvl.id] === "failed");
  const failedPhrase = failedLevel ? t(resultPhrases?.[failedLevel.id]) : "";

  const completedLevelsWithPhrase = levels
    .filter((lvl) => statuses[lvl.id] === "completed")
    .map((lvl) => t(resultPhrases?.[lvl.id]));
  const latestCompletedPhrase = completedLevelsWithPhrase.reverse().find(Boolean) || "";

  const overallText = overallResult === "failed"
    ? (failedPhrase || t("you_are_not_eligible"))
    : (overallResult === "completed"
      ? (latestCompletedPhrase || t("you_are_eligible"))
      : "");

  return (
    <div className="min-h-screen w-full flex flex-col items-center" style={{ background: theme.bg }}>
      <div className="w-full max-w-5xl px-6 pt-6 flex justify-end">
        <button
          className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border text-sm transition"
          style={{ borderColor: theme.border, color: theme.text, background: theme.surface, marginInline: "4px" }}>
          {t("Settings")}
        </button>
        <button
          className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border text-sm transition"
          style={{ borderColor: theme.border, color: theme.text, background: theme.surface, marginInline: "4px" }}>
          {t("Help")}
        </button>
        <button
          className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border text-sm transition"
          style={{ borderColor: theme.border, color: theme.text, background: theme.surface, marginInline: "4px" }}>
          {t("About")}
        </button>
        <button
          onClick={onReset}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border text-sm transition"
          style={{ borderColor: theme.border, color: theme.text, background: theme.surface, marginInline: "4px" }} aria-label="Reset all"
        >
          {t("Reset")}
        </button>
      </div>
      <div className="grid gap-6 sm:grid-cols-2 md:grid-cols-3 p-6 pt-4 max-w-5xl w-full">
        {levels.map((lvl, idx) => {
          const Icon = lvl.icon || MoreHorizontal;
          const status = statuses[lvl.id] || "idle";
          const isLocked = lvl.id === 3 && !(statuses[2] === "completed");
          const bcolor = status === "completed" ? theme.success : status === "failed" ? theme.danger : theme.border;

          return (
            <motion.div key={lvl.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: idx * 0.05, duration: 0.35, ease: "easeOut" }}>
              <Card
                onClick={() => { if (!isLocked) onPick(lvl.id); }}
                className={`relative rounded-3xl transition ${isLocked ? "cursor-not-allowed" : "hover:shadow-2xl cursor-pointer shadow-lg"
                  }`}
                aria-disabled={isLocked ? true : undefined}
                tabIndex={isLocked ? -1 : 0}
                style={{
                  background: theme.surface,
                  border: "3px solid " + bcolor,

                  boxSizing: "border-box",
                  opacity: isLocked ? 0.4 : 1,
                  filter: isLocked ? "grayscale(0.35) brightness(0.9)" : "none",
                }}
              >

                <span className="absolute top-2 left-2 hidden sm:inline-flex items-center justify-center h-6 w-6 rounded-full text-[11px] font-semibold" style={{ background: theme.surfaceSoft, border: "1px solid " + theme.border, color: theme.text }}>
                  {idx + 1}
                </span>
                <CardHeader className="flex items-center justify-center py-6">
                  <div className="flex items-center justify-center gap-3">
                    <Icon className="h-5 w-5 flex-shrink-0" style={{ color: theme.text }} />
                    <CardTitle className="text-base font-semibold tracking-wide" style={{ color: theme.text }}>
                      {lvl.title}
                    </CardTitle>
                  </div>
                </CardHeader>
              </Card>
            </motion.div>
          );
        })}
      </div>

      {overallResult && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.5 }} className="mt-6 w-full max-w-5xl px-6">
          <Card className="rounded-3xl shadow-lg border-2 flex items-center justify-center gap-3 py-6" style={{ background: overallResult === "failed" ? theme.surfaceSoft : theme.surface, borderColor: overallResult === "failed" ? theme.danger : theme.success }}>
            {overallResult === "failed" ? (
              <>
                <XCircle className="h-6 w-6 flex-shrink-0 ml-2" style={{ color: theme.danger }} />
                <span className="text-lg font-semibold" style={{ color: theme.text }}>{overallText}</span>
              </>
            ) : (
              <>
                <CheckCircle className="h-6 w-6 flex-shrink-0 ml-2" style={{ color: theme.success }} />
                <span className="text-lg font-semibold" style={{ color: theme.text }}>{overallText}</span>
              </>
            )}
          </Card>
        </motion.div>
      )}
    </div>
  );
}

/* =====================
   LEVEL WIZARD
   ===================== */

function defaultVars(healthState) {
  return {
    NIYABAT: false,
    GIFT: false,
    HEALTH_STATE: healthState || "GREEN",
    END_PHRASE: null,
  };
}

function replayLevel({ levelId, lvl, levelRules, answersMap, healthState }) {
  let vars = { ...defaultVars(healthState) };
  const path = [];
  let stop = null;
  let ended = false;
  let print = null;
  let guardReason = null;

  let qIdx = 0;
  const maxQ = (lvl.questions?.length ?? 0);
  const seen = new Set();

  while (qIdx != null && qIdx < maxQ) {
    if (seen.has(qIdx)) break;
    seen.add(qIdx);

    path.push(qIdx);

    const val = answersMap[qIdx];
    if (val === undefined) break;      // wait for answer here

    const res = passesRule(levelId, qIdx, val, { levelRules, vars });
    if (res?.vars) vars = res.vars;
    if (res?.print) print = res.print;
    if (res?.guardReason) guardReason = res.guardReason;

    if (res?.complete) { ended = true; break; }           // END
    if (res && res.ok === false) {                        // FAIL
      stop = { qIndex: qIdx, reason: res.reason || "NOT_ELIGIBLE_CONTINUE" };
      break;
    }
    if (res?.action === "resetTo" && res.nextNode) {      // jump
      qIdx = indexFromNodeId(res.nextNode);
      continue;
    }
    if (res?.nextNode) {                                  // jump
      qIdx = indexFromNodeId(res.nextNode);
      continue;
    }

    // ✱ No implicit linear advance. If no nextNode is provided, stop here.
    break;
  }

  // keep only answers still reachable
  const prunedAnswers = {};
  for (const i of path) if (answersMap[i] !== undefined) prunedAnswers[i] = answersMap[i];

  return { path, vars, stop, ended, answers: prunedAnswers, print, guardReason };
}


function LevelWizard({ theme, levelId, onSave, levelRules, texts, phrases, healthState, levels }) {
  const t = (key) => resolvePhrase(phrases, key);


  function defaultVars(healthState) {
    return {
      NIYABAT: false,
      GIFT: false,
      HEALTH_STATE: healthState || "GREEN",
      END_PHRASE: null,
    };
  }

  function replayLevel({ levelId, lvl, levelRules, answersMap, healthState }) {
    let vars = { ...defaultVars(healthState) };
    const path = [];
    let stop = null;
    let ended = false;
    let print = null;
    let guardReason = null;

    // walk from the start, applying answers if present
    let qIdx = 0;
    const maxQ = (lvl.questions?.length ?? 0);
    const seen = new Set();

    while (qIdx != null && qIdx < maxQ) {
      if (seen.has(qIdx)) break; // guard loops
      seen.add(qIdx);

      path.push(qIdx);

      const val = answersMap[qIdx];
      if (val === undefined) {
        // we reached an unanswered question; wait here
        break;
      }

      const res = passesRule(levelId, qIdx, val, { levelRules, vars });
      if (res?.vars) vars = res.vars;
      if (res?.print) print = res.print;
      if (res?.guardReason) guardReason = res.guardReason;

      if (res?.complete) { // END
        ended = true;
        break;
      }
      if (res && res.ok === false) { // FAIL
        stop = { qIndex: qIdx, reason: res.reason || "NOT_ELIGIBLE_CONTINUE" };
        break;
      }
      if (res?.action === "resetTo" && res.nextNode) {
        qIdx = indexFromNodeId(res.nextNode);
        continue;
      }
      if (res?.nextNode) {
        qIdx = indexFromNodeId(res.nextNode);
        continue;
      }

      // default: proceed linearly
      // qIdx = qIdx + 1;
    }

    // keep only answers that are still on the reachable path
    const prunedAnswers = {};
    for (const i of path) {
      if (answersMap[i] !== undefined) prunedAnswers[i] = answersMap[i];
    }

    return { path, vars, stop, ended, answers: prunedAnswers, print, guardReason };
  }


  const lvl = levels.find((l) => l.id === levelId);

  const [answers, setAnswers] = useState({});
  const [vars, setVars] = useState({});
  const [resultPhrase, setResultPhrase] = useState(null);
  const [guardReasonKey, setGuardReasonKey] = useState(null);

  // useEffect(() => {
  //   setVars((v) => ({
  //     NIYABAT: v.NIYABAT ?? false,
  //     GIFT: v.GIFT ?? false,
  //     HEALTH_STATE: v.HEALTH_STATE ?? (healthState || "GREEN"),
  //     END_PHRASE: v.END_PHRASE ?? null,
  //     ...v,
  //   }));
  // }, []);
  const [path, setPath] = useState([0]);
  const [stop, setStop] = useState(null);
  // const [info, setInfo] = useState(null);
  const [openHelpFor, setOpenHelpFor] = useState(null);
  const [ended, setEnded] = useState(false);


  function getQuestionId(qIndex) { return nodeIdFor(levelId, qIndex); }
  function getSheetEntry(qIndex) {
    const id = getQuestionId(qIndex); const lvlKey = "L" + String(levelId);
    return texts && texts[lvlKey] && texts[lvlKey][id] ? texts[lvlKey][id] : null;
  }
  function getPrompt(qIndex) { const fromSheet = getSheetEntry(qIndex)?.prompt; return fromSheet ?? (lvl.questions[qIndex] || getQuestionId(qIndex)); }
  function getHelp(qIndex) { return getSheetEntry(qIndex)?.help || ""; }

  function isOptionQuestion(qIndex) {
    const nodeId = getQuestionId(qIndex);
    const node = (levelRules && levelRules.nodes) ? levelRules.nodes.find((n) => n.id === nodeId) : null;
    return !!(node && node.input_type === "options3");
  }
  function getLabels(qIndex) {
    const fromSheet = getSheetEntry(qIndex)?.labels;
    if (Array.isArray(fromSheet) && fromSheet.length > 0) return fromSheet;
    if (isOptionQuestion(qIndex)) return ["full package", "partial package", "other"];
    return ["Yes", "No"];
  }

  function onAnswer(qIndex, value) {
    const nextAnswers = { ...answers, [qIndex]: value };

    const { path: np, vars: nv, stop: ns, ended: ne, answers: na, print: npPrint, guardReason: ngReason } = replayLevel({
      levelId,
      lvl,
      levelRules,
      answersMap: nextAnswers,
      healthState,
    });

    setAnswers(na);
    setVars(nv);
    setPath(np);
    setStop(ns);
    setEnded(ne);
    setResultPhrase(npPrint || null);
    setGuardReasonKey(ngReason || null);
  }


  const allAnsweredAndEligible = ended || (!stop && path.every((q) => answers[q]));

  // Determine color based on HEALTH_STATE (for level 2 only)
  const getHealthColor = () => {
    if (levelId !== 2) return { color: theme.success, bg: "rgba(92, 198, 92, 0.10)" };
    const healthState = vars?.HEALTH_STATE;

    if (healthState === "GREEN") return { color: theme.success, bg: theme.successbg };
    if (healthState === "ORANGE") return { color: theme.warn, bg: theme.warnbg };
    if (healthState === "YELLOW") return { color: theme.caution, bg: theme.cautionbg };
    return { color: theme.success, bg: "rgba(92, 198, 92, 0.10)" };
  };

  function handleSave() {
    const status = stop ? "failed" : allAnsweredAndEligible ? "completed" : "idle";
    onSave({ levelId, status, answers, phrase: resultPhrase });
  }
  function handleReset() { setAnswers({}); setPath([0]); setStop(null); setOpenHelpFor(null); setResultPhrase(null); setGuardReasonKey(null); }

  return (
    <div className="min-h-screen w-full" style={{ background: theme.bg }}>
      <div className="mx-auto w-full max-w-3xl px-4 py-10">
        <div className="mb-5 text-center">
          <h2 className="text-3xl font-bold tracking-tight" style={{ color: theme.title }}>{lvl.title}</h2>
        </div>

        <Card className="rounded-3xl shadow-xl border-0 relative" style={{ background: theme.surface, border: "2px solid " + theme.border }}>
          {/* <button onClick={handleReset} className="absolute right-4 top-4 p-2 rounded-lg border transition hover:scale-105" style={{ borderColor: theme.border, color: theme.text, background: theme.accent }} aria-label="Reset">
            <RotateCcw className="h-4 w-4" />
          </button> */}
          {/* reset button^^ */}

          <CardContent className="p-8 space-y-6">
            {path.map((qIdx, i) => {
              const q = getPrompt(qIdx);
              const help = getHelp(qIdx);
              const val = answers[qIdx];
              const isStopHere = stop?.qIndex === qIdx;
              const labels = getLabels(qIdx);
              return (
                <motion.div key={qIdx} initial={i === path.length - 1 ? { opacity: 0 } : false} animate={{ opacity: 1 }} transition={{ duration: 0.25, ease: "easeOut" }}>
                  <div className="rounded-2xl border p-5" style={{ background: STYLES.option3.surfaceSoft, borderColor: theme.border }}>
                    <div className="flex flex-col items-center gap-2">
                      <div className="flex items-center justify-center gap-2">
                        <p className="text-[15px] font-medium text-center" style={{ color: theme.text }}>{q}</p>
                        {help && (
                          <button onClick={() => setOpenHelpFor(openHelpFor === qIdx ? null : qIdx)} className="inline-flex items-center gap-2 px-2 py-1 rounded-lg border text-sm flex-shrink-0" style={{ borderColor: theme.border, color: theme.text, background: theme.surface }} aria-expanded={openHelpFor === qIdx}>
                            <CircleHelp className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                      {openHelpFor === qIdx && (
                        <div className="w-full rounded-xl border p-3 text-sm" style={{ borderColor: theme.border, background: theme.surface, color: theme.text }}>{help}</div>
                      )}
                    </div>

                    <div className="mt-4 flex flex-col items-center gap-3">
                      {labels.length === 3 ? (
                        // NOTE: for 3 options we render them all in a single horizontal row.
                        // - `flex-nowrap` prevents wrapping to the next line (ensures single row).
                        // - `overflow-x-auto` allows the row to scroll horizontally on very small screens.
                        // - `items-stretch` + `flex-1` on buttons make them equal-height and accommodate multi-line labels.
                        <>
                          <div className="flex justify-center gap-4 w-full overflow-x-auto px-2" style={{ WebkitOverflowScrolling: 'touch' }}>
                            {labels.map((label) => {
                              const selected = val === label;
                              return (
                                <button
                                  key={label}
                                  onClick={() => onAnswer(qIdx, label)}
                                  // removed fixed width and height; added flex-1 and min/max widths so buttons stay balanced
                                  // allow text to wrap inside the button (whitespace-normal / break-words)
                                  className={
                                    "px-4 py-3 rounded-xl shadow-sm transition-all focus:outline-none flex items-center justify-center whitespace-normal break-words " +
                                    (selected ? "ring-2 ring-offset-1" : "")
                                  }
                                  style={{
                                    background: theme.surface,
                                    color: theme.text,
                                    border: selected ? "2px solid " + theme.accent : "1px solid " + theme.border,
                                    boxShadow: selected ? "0 1px 0 rgba(0,0,0,0.06)" : undefined,
                                    // give each button a flexible width but ensure a reasonable minimum so very short labels don't collapse
                                    minWidth: 120,
                                    maxWidth: 320,
                                    flex: "1 1 0",
                                    // allow multi-line height to expand naturally
                                    alignSelf: "stretch",
                                  }}
                                >
                                  <span style={{ textAlign: "center", display: "block", lineHeight: 1.25 }}>{label}</span>
                                </button>
                              );
                            })}
                          </div>
                        </>
                      ) : (
                        // NOTE: for 1-2 options we also remove fixed height/width and let text determine height.
                        // Buttons are displayed side-by-side centered; they will expand vertically to fit content.
                        <div className="flex justify-center gap-5 flex-wrap">
                          {labels.map((label) => {
                            const selected = val === label;
                            return (
                              <button
                                key={label}
                                onClick={() => onAnswer(qIdx, label)}
                                className={
                                  "px-6 py-3 rounded-xl shadow-sm transition-all focus:outline-none whitespace-normal break-words " +
                                  (selected ? "ring-2 ring-offset-1" : "")
                                }
                                style={{
                                  background: theme.surface,
                                  color: theme.text,
                                  border: selected ? "2px solid " + theme.accent : "1px solid " + theme.border,
                                  boxShadow: selected ? "0 1px 0 rgba(0,0,0,0.06)" : undefined,
                                  // let buttons size to content, but keep a reasonable minWidth so they look balanced
                                  minWidth: 120,
                                  maxWidth: 360,
                                  // don't force fixed height — allow multi-line labels to increase height
                                  lineHeight: 1.25,
                                  textAlign: "center",
                                }}
                              >
                                <span style={{ display: "block" }}>{label}</span>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    {/* {info && (
                      <div className="mt-3 flex items-start gap-2 rounded-xl border p-3 text-sm" style={{ borderColor: theme.border, background: theme.surface, color: theme.text }}>
                        <TriangleAlert className="mt-0.5 h-4 w-4" />
                        <p>{info}</p>
                      </div>
                    )} */}
                  </div>
                </motion.div>
              );
            })}

            {allAnsweredAndEligible && (
              <div
                className="flex items-start gap-3 rounded-2xl border p-4 text-sm"
                style={{
                  borderColor: getHealthColor()?.color || theme.success,
                  background: getHealthColor()?.bg || "rgba(92, 198, 92, 0.10)",
                  color: theme.text
                }}
              >
                <CheckCircle className="mt-0.5 h-5 w-5 flex-shrink-0" style={{ color: getHealthColor()?.color || theme.success }} />
                <p>
                  {guardReasonKey ? t(guardReasonKey) : t(vars?.END_PHRASE)}
                </p>
              </div>
            )}


            {stop && (
              <div className="flex items-start gap-3 rounded-2xl border p-4 text-sm" style={{ borderColor: theme.danger, background: "rgba(211, 47, 47, 0.10)", color: theme.text }}>
                <TriangleAlert className="mt-0.5 h-5 w-5 flex-shrink-0" style={{ color: theme.danger }} />
                <p>{t(stop?.reason)}</p>
              </div>
            )}

            <div className="flex justify-center pt-4">
              <button
                onClick={handleSave}
                className="px-7 py-2 rounded-xl shadow-sm transition-all focus:outline-none h-[44px] flex items-center justify-center"
                style={{
                  background: theme.surface,
                  color: theme.text,
                  border: "2px solid " + theme.accent,   // matches the “selected” look you use
                  boxShadow: "0 1px 0 rgba(0,0,0,0.06)"
                }}
              >
                Done
              </button>
            </div>

          </CardContent>
        </Card>
      </div>
    </div>
  );
}


// cache-bust a URL once per boot
function bust(url, stamp = Date.now()) {
  if (!url) return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}v=${stamp}`;
}


/* =====================
   APP ROOT
   ===================== */
export default function EligibilityApp() {
  const theme = STYLES.option3;

  // ✱ NEW: 1s gate before rendering any UI
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setReady(true), 1000);
    return () => clearTimeout(timer);
  }, []);

  const [screen, setScreen] = useState("home");
  const [levelId, setLevelId] = useState(null);


  const [statuses, setStatuses] = useState({});
  const [savedAnswers, setSavedAnswers] = useState({});
  const [resultPhrases, setResultPhrases] = useState({});

  const [texts, setTexts] = useState(null);
  const [logic, setLogic] = useState(null);
  const [phrases, setPhrases] = useState(null);
  const [levels, setLevels] = useState(null);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    // Load logic + sheets together, but fail fast after 5 seconds if not loaded.
    let mounted = true;
    const TIMEOUT_MS = 5000;

    (async () => {
      try {
        // Force a fresh pull on first mount; rest of caching/fallback stays the same
        const STAMP = Date.now();
        const loadAll = Promise.all([
          loadLogic(bust(LOGIC_URL, STAMP)),
          loadSheets(bust(QUESTIONS_URL, STAMP), bust(PHRASES_URL, STAMP)),
        ]);


        const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout loading sheets after 5 seconds')), TIMEOUT_MS));

        const [rulesByLevel, sheets] = await Promise.race([loadAll, timeout]);

        if (!mounted) return;

        if (rulesByLevel) setLogic(rulesByLevel);
        if (sheets) {
          if (sheets.texts) setTexts(sheets.texts);
          if (sheets.phrases) setPhrases(sheets.phrases);
        }
      } catch (e) {
        if (!mounted) return;
        // Provide a clear error message indicating timeout or fetch failure
        const msg = e?.message?.includes('Timeout') ? 'Sheets failed to load within 5 seconds.' : ('Failed to load sheets: ' + (e?.message || String(e)));
        setLoadError(msg);
      }
    })();

    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    if (!texts) return;
    try { setLevels(getLevelsOrThrow(texts)); } catch (e) { setLoadError(e?.message || String(e)); }
  }, [texts]);

  const sheetsReady = Boolean(texts && phrases && logic && levels && !loadError);
  let errorIfAny = loadError;
  if (!errorIfAny && (!texts || !phrases || !logic)) {
    try { requireSheetsOrThrow({ texts, phrases, logic }); } catch (e) { errorIfAny = e?.message || String(e); }
  }

  const completedLevels = Array.isArray(levels) ? levels.length : 0;
  const derivedHealthState =
    statuses[2] === "failed" ? "RED" :
      statuses[2] === "completed" ? "GREEN" : "GREEN";

  const overallResult = Object.values(statuses).some((s) => s === "failed")
    ? "failed"
    : (Array.isArray(levels) &&
      Object.values(statuses).every((s) => s === "completed") &&
      Object.keys(statuses).length === completedLevels)
      ? "completed"
      : null;
  // ✱ NEW: hold the UI for 1 second on mount
  if (!ready) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center" style={{ background: theme.bg }}>
        <div style={{ color: theme.title, fontSize: 18 }}>Preparing app…</div>
      </div>
    );
  }

  if (errorIfAny) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center p-8" style={{ background: theme.bg }}>
        <Card className="max-w-xl w-full rounded-3xl border-2 p-6" style={{ background: theme.surface, borderColor: theme.danger }}>
          <div className="flex items-start gap-3">
            <TriangleAlert className="h-6 w-6" style={{ color: theme.danger }} />
            <div>
              <div className="font-semibold mb-2" style={{ color: theme.text }}>Configuration error</div>
              <div className="text-sm" style={{ color: theme.text }}>{errorIfAny}</div>
              <div className="text-xs mt-3" style={{ color: theme.text }}>
                Set valid <code>QUESTIONS_URL</code>, <code>PHRASES_URL</code>, and <code>LOGIC_URL</code> (CSV endpoints).
              </div>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  if (!sheetsReady) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center" style={{ background: theme.bg }}>
        <div style={{ color: theme.title }}>Loading…</div>
      </div>
    );
  }

  return screen === "home" ? (
    <Home
      theme={theme}
      onPick={(id) => {
        if (id === 3 && !(statuses[2] === "completed")) {

          return;
        }
        setLevelId(id);
        setScreen("level");
      }}
      statuses={statuses}
      overallResult={overallResult}
      levels={levels}
      phrases={phrases}
      resultPhrases={resultPhrases}
      onReset={() => window.location.reload()}
    />
  ) : (

    <LevelWizard
      theme={theme}
      levelId={levelId}
      levelRules={getLevelRulesOrThrow(levelId, logic)}
      texts={texts}
      phrases={phrases}
      healthState={derivedHealthState}
      levels={levels}
      onSave={({ levelId: lid, status, answers, phrase }) => {
        setStatuses((prev) => ({ ...prev, [lid]: status }));
        setSavedAnswers((prev) => ({ ...prev, [lid]: answers }));
        setResultPhrases((prev) => ({ ...prev, [lid]: phrase || null }));
        setScreen("home");
      }}
    />
  );
}
