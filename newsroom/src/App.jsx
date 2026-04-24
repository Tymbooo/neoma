import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import {
  Cpu,
  Globe,
  Star,
  Landmark,
  Briefcase,
  Moon,
  ShieldAlert,
  Play,
  Pause,
  Globe2,
  Radio,
  Music,
  X,
  ArrowRight,
  ClipboardCheck,
  ChevronDown,
  GraduationCap,
  CheckCircle,
  Eye,
  Bug,
} from "lucide-react";
import { DEFAULT_LEVELS } from "./radioLevels";

/** True if the audio element is still showing this clip (not a stale src after natural end + index advance). */
function audioSrcMatchesUrl(audioEl, url) {
  if (!audioEl?.src || !url) return false;
  if (audioEl.src === url) return true;
  try {
    return new URL(audioEl.src).href === new URL(url).href;
  } catch {
    return false;
  }
}

/** Allowed auto-continue pauses (ms) between sentence clips; default 100ms. */
const AUTO_NEXT_DELAY_OPTIONS_MS = [0, 100, 200, 300, 400, 500];
const AUTO_NEXT_DELAY_DEFAULT_MS = 100;

/** Match ingest `normalizeLineForWordTokens` + token split (NBSP / ZWSP). */
// Tokenization rule (MUST stay in sync with the Stage 2 prompt in
// lib/radioIngest.js → stage2UserPrompt "Token = one gloss (strict)"):
// split each line on whitespace only; each maximal run of non-whitespace is
// exactly one token and receives exactly one gloss. Punctuation stays attached.
// If this rule changes, update the server prompt too or gloss alignment breaks.
function lineWordTokens(sentenceText) {
  const cleaned = String(sentenceText || "")
    .replace(/[\u200b\u200c\u200d\ufeff]/g, "")
    .replace(/[\u00a0\u202f]/g, " ");
  return cleaned.match(/[^\s]+/g) || [];
}

/** Build a visible message when POST /api/newspaper?radio=ingest fails (handles empty JSON, trace-only errors). */
function summarizeRadioIngestFailure(j, httpStatus) {
  const lines = [];
  const pushLine = (s) => {
    const t = String(s || "").trim();
    if (t && !lines.includes(t)) lines.push(t);
  };
  const err = j?.error;
  if (err != null && err !== "") {
    pushLine(typeof err === "string" ? err : JSON.stringify(err));
  }
  if (typeof j?.message === "string") pushLine(j.message);
  if (j?.hint != null) pushLine(typeof j.hint === "string" ? j.hint : JSON.stringify(j.hint));
  if (j?.levelConstraintHint != null) {
    pushLine(typeof j.levelConstraintHint === "string" ? j.levelConstraintHint : JSON.stringify(j.levelConstraintHint));
  }
  const trace = j?.ingestTrace;
  if (Array.isArray(trace) && trace.length > 0) {
    for (let i = trace.length - 1; i >= 0; i--) {
      const row = trace[i];
      if (!row || typeof row !== "object") continue;
      const w = row.where || row.step;
      const m = row.message || row.error || row.reason || row.lastError;
      if (m || row.step === "fail") {
        const piece = [w, m].filter(Boolean).join(": ");
        if (piece) {
          pushLine(`Trace: ${piece}`);
          break;
        }
      }
    }
  }
  if (lines.length === 0) {
    pushLine(
      httpStatus
        ? `Request failed (HTTP ${httpStatus}). The response had no error details — open “Technical” below, check the browser Network tab for the response body, or retry with “Include ingest debug trace”.`
        : "Ingest failed with no details from the server."
    );
  }
  return lines.join("\n\n");
}

/** In-flow (not absolute) so line boxes include gloss height and wrapped lines do not overlap.
 * Glosses are breakable so the column's `max-w-min` collapses to the Spanish token's width,
 * keeping sentence spacing uniform even when the English gloss is longer than its token. */
function wordGlossClass(vis) {
  const base =
    "pointer-events-none w-full min-h-[0.75rem] text-center text-[8px] md:text-[9px] font-medium text-stone-500 leading-tight break-words [overflow-wrap:anywhere]";
  if (vis === "on") {
    return `${base} opacity-100 transition-none`;
  }
  if (vis === "fade") {
    return `${base} opacity-0 transition-opacity duration-[3000ms] ease-out`;
  }
  return `${base} opacity-0 transition-none`;
}

function WordStackLine({ sentenceText, wordGlossesEn, glossVisibility = "off" }) {
  const tokens = useMemo(() => lineWordTokens(sentenceText), [sentenceText]);
  const useRowGlosses =
    Array.isArray(wordGlossesEn) && wordGlossesEn.length === tokens.length;
  // Spanish + gloss per token: each token is `inline-flex` column (word, then
  // gloss) so gloss height participates in the line box — the next wrapped
  // line of Spanish starts below the gloss band instead of colliding with it.
  return (
    <p
      className="my-1.5 text-left w-full min-w-0 text-sm md:text-base leading-normal"
      style={{ wordSpacing: "normal" }}
    >
      {tokens.map((tok, i) => {
        const gloss = useRowGlosses
          ? String(wordGlossesEn[i] || "").trim()
          : "";
        return (
          <React.Fragment key={`${i}-${tok}`}>
            {i > 0 ? " " : null}
            <span className="inline-flex max-w-min flex-col items-center align-baseline gap-0.5">
              <span className="font-bold text-stone-900 whitespace-nowrap">
                {tok}
              </span>
              {useRowGlosses ? (
                <span
                  className={wordGlossClass(glossVisibility)}
                  title={gloss || undefined}
                >
                  {gloss || "\u00a0"}
                </span>
              ) : null}
            </span>
          </React.Fragment>
        );
      })}
    </p>
  );
}

const DIFF_TO_LEVEL = { A1: 1, A2: 2, B1: 3, B2: 4, C1: 5, C2: 6 };

const TOPICS = [
  {
    id: 1,
    title: "Tech News",
    icon: Cpu,
    bg: "bg-teal-400",
    duration: "12m",
    feedTopic: "tech",
    news: [],
  },
  {
    id: 3,
    title: "Geo-politics",
    icon: Globe,
    bg: "bg-emerald-400",
    duration: "18m",
    feedTopic: null,
    news: [
      "EU Trade Policy",
      "ASEAN Summit Results",
      "Arctic Resource War",
      "Global Energy Shift",
      "BRICS Expansion",
      "Diplomatic Tensions",
      "UN Security Vote",
      "Trade Route Security",
    ],
  },
  {
    id: 4,
    title: "Pop Culture",
    icon: Star,
    bg: "bg-pink-400",
    duration: "08m",
    feedTopic: null,
    news: [
      "Met Gala Best Dressed",
      "Secret Hollywood Split",
      "Album Release Teasers",
      "Reality TV Drama",
      "Award Show Snubs",
      "Viral Red Carpet Look",
      "Influencer Scandals",
      "Iconic Fashion Moments",
    ],
  },
  {
    id: 5,
    title: "ES History",
    icon: Landmark,
    bg: "bg-amber-400",
    duration: "32m",
    feedTopic: null,
    news: [
      "The Roman Influence",
      "Visigoth Kingdoms",
      "Islamic Al-Andalus",
      "The Reconquista",
      "Empire Golden Age",
      "Civil War Lessons",
      "Democracy Transition",
      "Modern Spanish Identity",
    ],
  },
  {
    id: 6,
    title: "Business",
    icon: Briefcase,
    bg: "bg-blue-400",
    duration: "15m",
    feedTopic: null,
    news: [
      "Fed Interest Rates",
      "Stock Market Rally",
      "Remote Work Future",
      "E-commerce Trends",
      "Sustainable Investing",
      "Corporate Leadership",
      "Crypto Market Status",
      "Global Supply Chain",
    ],
  },
  {
    id: 7,
    title: "Sleep Music",
    icon: Moon,
    bg: "bg-indigo-400",
    duration: "60m",
    feedTopic: null,
    news: [
      "Deep Sleep Waves",
      "Rain Forest Sounds",
      "Ambient Piano",
      "Delta Wave Pulse",
      "White Noise Blend",
      "Night Cicadas",
      "Gentle Ocean Flow",
      "Soft Zen Flute",
    ],
  },
  {
    id: 8,
    title: "True Crime",
    icon: ShieldAlert,
    bg: "bg-red-400",
    duration: "28m",
    feedTopic: null,
    news: [
      "Cold Case Reopened",
      "Digital Heist Secrets",
      "The Zodiac Mystery",
      "Modern DNA Breakthroughs",
      "Conspiracy Theories",
      "Famous Art Thefts",
      "Missing Person Leads",
      "Psychology of Crime",
    ],
  },
];

const LANGUAGES = ["Spanish", "French", "German", "Japanese", "English", "Italian"];
const DIFFICULTIES = ["A1", "A2", "B1", "B2", "C1", "C2"];

const BRIDGE_MS = 30_000;

function localDoneKey(topicSlug, level) {
  return `radioDone:${topicSlug}:L${level}`;
}

function readLocalDone(topicSlug, level) {
  try {
    const raw = localStorage.getItem(localDoneKey(topicSlug, level));
    if (!raw) return new Set();
    const o = JSON.parse(raw);
    return new Set(Object.keys(o || {}));
  } catch {
    return new Set();
  }
}

function writeLocalDone(topicSlug, level, storyId) {
  try {
    const key = localDoneKey(topicSlug, level);
    const cur = JSON.parse(localStorage.getItem(key) || "{}");
    cur[storyId] = true;
    localStorage.setItem(key, JSON.stringify(cur));
  } catch {
    /* ignore */
  }
}

function readGuestStreak() {
  try {
    return JSON.parse(localStorage.getItem("radioGuestStreak") || "null");
  } catch {
    return null;
  }
}

function bumpGuestStreak() {
  const today = new Date().toISOString().slice(0, 10);
  const y = new Date();
  y.setUTCDate(y.getUTCDate() - 1);
  const yesterday = y.toISOString().slice(0, 10);
  const prev = readGuestStreak() || { lastDay: null, streak: 0 };
  if (prev.lastDay === today) {
    return prev.streak || 1;
  }
  if (prev.lastDay === yesterday) {
    const next = (prev.streak || 0) + 1;
    localStorage.setItem("radioGuestStreak", JSON.stringify({ lastDay: today, streak: next }));
    return next;
  }
  localStorage.setItem("radioGuestStreak", JSON.stringify({ lastDay: today, streak: 1 }));
  return 1;
}

async function getAccessToken() {
  const r = await fetch("/api/supabase/config");
  const cfg = await r.json().catch(() => ({}));
  if (!r.ok || !cfg.url || !cfg.anonKey) return null;
  const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2.49.1");
  const sb = createClient(cfg.url, cfg.anonKey, {
    auth: { persistSession: true, autoRefreshToken: true },
  });
  const {
    data: { session },
  } = await sb.auth.getSession();
  return session?.access_token ?? null;
}

export default function App() {
  const [language, setLanguage] = useState("Spanish");
  const [difficulty, setDifficulty] = useState("B1");
  const [expandedTopic, setExpandedTopic] = useState(null);
  const [selectedNews, setSelectedNews] = useState({});
  const [feedStories, setFeedStories] = useState([]);
  const [feedLoading, setFeedLoading] = useState(false);
  const [feedError, setFeedError] = useState("");
  const [streak, setStreak] = useState(0);
  const [serverCompleted, setServerCompleted] = useState([]);

  const [session, setSession] = useState(null);
  const sessionRef = useRef(null);
  sessionRef.current = session;

  const audioRef = useRef(null);
  const autoAdvanceTimeoutRef = useRef(null);
  const [audioReady, setAudioReady] = useState(false);
  const [, bumpAudioUi] = useReducer((x) => x + 1, 0);
  const [bridgeLeftMs, setBridgeLeftMs] = useState(0);
  const [bridgePick, setBridgePick] = useState(null);
  const [expandedWord, setExpandedWord] = useState(null);
  const [autoContinueAudio, setAutoContinueAudio] = useState(true);
  const autoContinueAudioRef = useRef(true);
  useEffect(() => {
    autoContinueAudioRef.current = autoContinueAudio;
  }, [autoContinueAudio]);
  const [autoContinueDelayMs, setAutoContinueDelayMs] = useState(AUTO_NEXT_DELAY_DEFAULT_MS);
  const autoContinueDelayRef = useRef(AUTO_NEXT_DELAY_DEFAULT_MS);
  useEffect(() => {
    autoContinueDelayRef.current = autoContinueDelayMs;
  }, [autoContinueDelayMs]);
  const [autoContinueMenuOpen, setAutoContinueMenuOpen] = useState(false);

  const [radioAdminBusy, setRadioAdminBusy] = useState(false);
  const [radioAdminMsg, setRadioAdminMsg] = useState("");
  const [radioAdminTech, setRadioAdminTech] = useState("");
  const [ingestDebugTrace, setIngestDebugTrace] = useState(false);
  // Per-ingest level overrides (Niveles panel). Defaults: everything enabled
  // with the hardcoded prompt from radioLevels.js. Not persisted between sessions.
  const [levelConfig, setLevelConfig] = useState(() =>
    DEFAULT_LEVELS.map((L) => ({
      level: L.level,
      cefr: L.cefr,
      enabled: true,
      prompt: L.defaultPrompt,
    }))
  );
  const [expandedLevelIdx, setExpandedLevelIdx] = useState(null);
  const activeLevelCount = levelConfig.filter((x) => x.enabled).length;
  const ingestBlockedByLevels = activeLevelCount === 0;
  const buildLevelOverridesBody = () =>
    levelConfig.map(({ level, enabled, prompt }) => ({
      level,
      enabled,
      prompt,
    }));

  const levelNum = DIFF_TO_LEVEL[difficulty] || 3;
  /** Ingest UI: visible by default; set VITE_RADIO_ADMIN_UI=0 at build time to hide. Server still enforces RADIO_ADMIN_EMAILS. */
  const showRadioAdminUi = import.meta.env.VITE_RADIO_ADMIN_UI !== "0";

  const refreshProgress = useCallback(async () => {
    const token = await getAccessToken();
    if (!token) {
      const g = readGuestStreak();
      setStreak(g?.streak || 0);
      setServerCompleted([]);
      return;
    }
    const slug = "tech";
    const r = await fetch(`/api/newspaper?radio=progress&topic=${encodeURIComponent(slug)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const j = await r.json().catch(() => ({}));
    if (r.ok) {
      setStreak(typeof j.streak === "number" ? j.streak : 0);
      setServerCompleted(Array.isArray(j.completed) ? j.completed : []);
    }
  }, []);

  useEffect(() => {
    refreshProgress();
  }, [refreshProgress]);

  useEffect(() => {
    const slug = expandedTopic?.feedTopic;
    const topicId = expandedTopic?.id;
    if (!slug || !topicId) {
      setFeedStories([]);
      setFeedError("");
      return;
    }
    let cancelled = false;
    (async () => {
      setFeedLoading(true);
      setFeedError("");
      try {
        const r = await fetch(
          `/api/newspaper?radio=feed&topic=${encodeURIComponent(slug)}&level=${levelNum}`
        );
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error || r.statusText);
        if (cancelled) return;
        setFeedStories(Array.isArray(j.stories) ? j.stories : []);
        const localDone = readLocalDone(slug, levelNum);
        const doneServer = new Set(
          (serverCompleted || [])
            .filter((c) => c.level === levelNum)
            .map((c) => c.storyId)
        );
        setSelectedNews((prev) => {
          const next = { ...prev };
          const map = {};
          for (const s of j.stories || []) {
            const done = doneServer.has(s.id) || localDone.has(s.id);
            map[s.id] = !done;
          }
          next[topicId] = map;
          return next;
        });
      } catch (e) {
        if (!cancelled) setFeedError(e.message || "Feed error");
      } finally {
        if (!cancelled) setFeedLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [expandedTopic?.feedTopic, expandedTopic?.id, levelNum, serverCompleted]);

  const toggleNewsItem = (topicId, itemKey) => {
    setSelectedNews((prev) => ({
      ...prev,
      [topicId]: {
        ...(prev[topicId] || {}),
        [itemKey]: !(prev[topicId]?.[itemKey] ?? true),
      },
    }));
  };

  const handleExpand = (topic) => {
    setExpandedTopic(topic);
    if (topic.feedTopic) return;
    if (!selectedNews[topic.id]) {
      setSelectedNews((prev) => ({
        ...prev,
        [topic.id]: topic.news.reduce((acc, item) => ({ ...acc, [item]: true }), {}),
      }));
    }
  };

  const markComplete = useCallback(
    async (story, topicMeta) => {
      const slug = topicMeta?.feedTopic || "tech";
      writeLocalDone(slug, levelNum, story.id);
      const guest = bumpGuestStreak();
      const token = await getAccessToken();
      if (token) {
        const r = await fetch("/api/newspaper?radio=progress", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ storyId: story.id, level: levelNum }),
        });
        const j = await r.json().catch(() => ({}));
        if (r.ok && typeof j.streak === "number") {
          setStreak(j.streak);
        } else {
          await refreshProgress();
        }
      } else if (!token) {
        setStreak(guest);
      } else {
        await refreshProgress();
      }
      const tid = topicMeta?.id;
      if (!tid) return;
      setSelectedNews((prev) => ({
        ...prev,
        [tid]: { ...(prev[tid] || {}), [story.id]: false },
      }));
    },
    [levelNum, refreshProgress]
  );

  const stopSession = () => {
    if (autoAdvanceTimeoutRef.current) {
      clearTimeout(autoAdvanceTimeoutRef.current);
      autoAdvanceTimeoutRef.current = null;
    }
    const a = audioRef.current;
    if (a) {
      a.pause();
      a.removeAttribute("src");
      a.load();
    }
    setSession(null);
    setBridgeLeftMs(0);
    setBridgePick(null);
    setAudioReady(false);
    setExpandedWord(null);
  };

  const startBroadcast = () => {
    if (!expandedTopic) return;
    if (expandedTopic.feedTopic) {
      const sel = selectedNews[expandedTopic.id] || {};
      const queue = feedStories.filter((s) => sel[s.id]);
      if (queue.length === 0) return;
      setExpandedTopic(null);
      setSession({
        topic: expandedTopic,
        queue,
        index: 0,
        phase: "playing",
      });
      setBridgeLeftMs(0);
      setBridgePick(null);
      setExpandedWord(null);
      return;
    }
    setExpandedTopic(null);
  };

  const currentStory = session?.queue?.[session.index] || null;

  const sentencesList = useMemo(() => {
    if (!currentStory) return [];
    const s = currentStory;
    if (Array.isArray(s.sentences) && s.sentences.length > 0) return s.sentences;
    const t = String(s.displayBody || "").trim();
    if (!t) return [];
    const lines = t.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (lines.length >= 2) return lines.map((text) => ({ text, audioUrl: s.audioUrl || null }));
    const parts = t.split(/(?<=[.!?…])\s+/).map((x) => x.trim()).filter(Boolean);
    const chunks = parts.length > 1 ? parts : [t];
    return chunks.map((text) => ({ text, audioUrl: s.audioUrl || null }));
  }, [currentStory]);

  const sentencesRef = useRef(sentencesList);
  sentencesRef.current = sentencesList;

  const [sentenceIndex, setSentenceIndex] = useState(0);
  const sentenceIndexRef = useRef(0);
  sentenceIndexRef.current = sentenceIndex;

  const sentenceCardRefs = useRef([]);

  const glossRevealTimerRef = useRef({ tHold: null, tFadeEnd: null });
  const [glossVisibilityAll, setGlossVisibilityAll] = useState("off");
  const [articleTtsDebugOpen, setArticleTtsDebugOpen] = useState(false);

  const clearGlossRevealTimers = useCallback(() => {
    const t = glossRevealTimerRef.current;
    if (t.tHold) clearTimeout(t.tHold);
    if (t.tFadeEnd) clearTimeout(t.tFadeEnd);
    glossRevealTimerRef.current = { tHold: null, tFadeEnd: null };
  }, []);

  const flashAllGlosses = useCallback(() => {
    clearGlossRevealTimers();
    setGlossVisibilityAll("on");
    const tHold = setTimeout(() => {
      setGlossVisibilityAll("fade");
      const tFadeEnd = setTimeout(() => {
        setGlossVisibilityAll("off");
        clearGlossRevealTimers();
      }, 3000);
      glossRevealTimerRef.current = { tHold: null, tFadeEnd };
    }, 2000);
    glossRevealTimerRef.current = { tHold, tFadeEnd: null };
  }, [clearGlossRevealTimers]);

  useEffect(
    () => () => {
      const t = glossRevealTimerRef.current;
      if (t.tHold) clearTimeout(t.tHold);
      if (t.tFadeEnd) clearTimeout(t.tFadeEnd);
    },
    []
  );

  useEffect(() => {
    if (autoAdvanceTimeoutRef.current) {
      clearTimeout(autoAdvanceTimeoutRef.current);
      autoAdvanceTimeoutRef.current = null;
    }
    const t = glossRevealTimerRef.current;
    if (t.tHold) clearTimeout(t.tHold);
    if (t.tFadeEnd) clearTimeout(t.tFadeEnd);
    glossRevealTimerRef.current = { tHold: null, tFadeEnd: null };
    setGlossVisibilityAll("off");
    setArticleTtsDebugOpen(false);
    sentenceCardRefs.current = [];
    setSentenceIndex(0);
    setAudioReady(false);
    const a = audioRef.current;
    if (a) {
      a.pause();
      a.removeAttribute("src");
      a.load();
    }
  }, [session?.index, currentStory?.id, currentStory?.level]);

  const afterStoryFinished = useCallback(() => {
    const s = sessionRef.current;
    if (!s || s.phase !== "playing") return;
    const story = s.queue[s.index];
    if (!story || !s.topic) return;
    markComplete(story, s.topic);
    setSession((prev) => {
      if (!prev) return prev;
      const nextIndex = prev.index + 1;
      if (nextIndex >= prev.queue.length) return null;
      return { ...prev, phase: "bridge", bridgeStartedAt: Date.now() };
    });
  }, [markComplete]);

  const advanceAfterBridge = useCallback(() => {
    setSession((prev) => {
      if (!prev) return prev;
      const nextIndex = prev.index + 1;
      if (nextIndex >= prev.queue.length) {
        return null;
      }
      return { ...prev, index: nextIndex, phase: "playing" };
    });
    setBridgeLeftMs(0);
    setBridgePick(null);
  }, []);

  /** `clipIndex` ties playback and onEnded to this sentence card (same order as API `sentences`). */
  const playSentenceAudio = useCallback(
    (url, clipIndex) => {
      if (autoAdvanceTimeoutRef.current) {
        clearTimeout(autoAdvanceTimeoutRef.current);
        autoAdvanceTimeoutRef.current = null;
      }
      const a = audioRef.current;
      if (!a || !url) return;
      setSentenceIndex(clipIndex);
      setAudioReady(false);
      a.pause();
      a.src = url;
      a.load();
      const onCanPlay = () => {
        setAudioReady(true);
        a.play().catch(() => {});
      };
      const onEnded = () => {
        a.removeEventListener("play", onPlayPause);
        a.removeEventListener("pause", onPlayPause);
        const sents = sentencesRef.current;
        const next = clipIndex + 1;
        if (next >= sents.length) {
          queueMicrotask(() => afterStoryFinished());
          return;
        }
        if (!autoContinueAudioRef.current) {
          return;
        }
        setSentenceIndex((prev) => (prev !== clipIndex ? prev : next));
        const nextRow = sents[next];
        if (nextRow?.audioUrl) {
          autoAdvanceTimeoutRef.current = setTimeout(() => {
            autoAdvanceTimeoutRef.current = null;
            if (sessionRef.current?.phase !== "playing") return;
            if (sentenceIndexRef.current !== next) return;
            playSentenceAudio(nextRow.audioUrl, next);
          }, Math.max(0, Number(autoContinueDelayRef.current) || 0));
        }
      };
      const onPlayPause = () => bumpAudioUi();
      a.addEventListener("canplay", onCanPlay, { once: true });
      a.addEventListener("ended", onEnded, { once: true });
      a.addEventListener("play", onPlayPause);
      a.addEventListener("pause", onPlayPause);
    },
    [afterStoryFinished]
  );

  const replaySentence = useCallback(
    (clipIndex) => {
      const row = sentencesRef.current[clipIndex];
      if (!row?.audioUrl) return;
      playSentenceAudio(row.audioUrl, clipIndex);
    },
    [playSentenceAudio]
  );

  const togglePlayPauseForIndex = useCallback(
    (i) => {
      const sents = sentencesRef.current;
      const row = sents[i];
      if (!row) return;
      const a = audioRef.current;
      if (row.audioUrl) {
        if (sentenceIndex === i && a?.src && !a.paused) {
          a.pause();
          bumpAudioUi();
          return;
        }
        // Do not "resume" after a clip has ended (ended=true) or when src is still the previous
        // sentence's file — otherwise the next card's Escuchar replays the finished clip.
        if (
          sentenceIndex === i &&
          a?.paused &&
          a.currentTime > 0 &&
          a.src &&
          !a.ended &&
          audioSrcMatchesUrl(a, row.audioUrl)
        ) {
          a.play().catch(() => {});
          return;
        }
        playSentenceAudio(row.audioUrl, i);
        return;
      }
      setSentenceIndex(i);
    },
    [sentenceIndex, playSentenceAudio]
  );

  const handleSentenceTap = useCallback(() => {
    const s = sessionRef.current;
    if (!s || s.phase !== "playing") return;
    togglePlayPauseForIndex(sentenceIndex);
  }, [sentenceIndex, togglePlayPauseForIndex]);

  const hasAnySentenceAudio = sentencesList.some((x) => x.audioUrl);

  const articleTtsDebugPayload = useMemo(() => {
    if (!currentStory) return null;
    const text = String(currentStory.voiceInputText || "").trim();
    const voiceId = sentencesList[0]?.grokVoiceRequest?.voice_id;
    if (!text && !voiceId) return null;
    return { voice_id: voiceId || null, text: text || null };
  }, [currentStory, sentencesList]);

  useEffect(() => {
    if (!session || session.phase !== "playing" || !currentStory) return;
    const el = sentenceCardRefs.current[sentenceIndex];
    el?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [sentenceIndex, session?.phase, session?.index, currentStory?.id, currentStory?.level]);

  useEffect(() => {
    if (!session || session.phase !== "bridge") return;
    const start = session.bridgeStartedAt || Date.now();
    const tick = () => {
      const left = Math.max(0, BRIDGE_MS - (Date.now() - start));
      setBridgeLeftMs(left);
      if (left <= 0) {
        advanceAfterBridge();
      }
    };
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [session, advanceAfterBridge]);

  const bridgeMcq = currentStory?.meta?.bridge_mcq || null;

  const submitBridge = () => {
    advanceAfterBridge();
  };

  const swapDifficultyWhilePlaying = async (nextDiff) => {
    setDifficulty(nextDiff);
    const s = sessionRef.current;
    if (!s?.topic?.feedTopic) return;
    const ln = DIFF_TO_LEVEL[nextDiff] || 3;
    const r = await fetch(
      `/api/newspaper?radio=feed&topic=${encodeURIComponent(s.topic.feedTopic)}&level=${ln}`
    );
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return;
    const byId = new Map((j.stories || []).map((x) => [x.id, x]));
    setSession((prev) => {
      if (!prev) return prev;
      const q = prev.queue.map((row) => byId.get(row.id) || row);
      return { ...prev, queue: q };
    });
    await refreshProgress();
  };

  const runRadioIngestAdmin = async ({
    dryRun = false,
    replaceTopic = false,
    debugTrace = false,
  } = {}) => {
    const t0 = Date.now();
    const log = (m, extra) => {
      const line = `[radio-admin-ingest +${Date.now() - t0}ms] ${m}`;
      console.warn(line, extra ?? "");
    };
    setRadioAdminBusy(true);
    setRadioAdminMsg("Starting… (getting session)");
    setRadioAdminTech("");
    log("click", { dryRun, replaceTopic, debugTrace });
    try {
      const token = await getAccessToken();
      if (!token) {
        log("no access_token from Supabase session");
        setRadioAdminMsg(
          "No session: open the main Neoma app on this same site, sign in with Supabase, then return here and try again. (Or your /api/supabase/config request failed.)"
        );
        return;
      }
      // Two-phase for real runs: POST ingest with skipTts → insert rows fast, then POST
      // backfill-tts to generate audio in a second serverless call. Each phase fits under
      // Vercel's 300s cap; the old single-shot call regularly hit FUNCTION_INVOCATION_TIMEOUT.
      const twoPhase = !dryRun;
      log("have token, POST /api/newspaper?radio=ingest", { twoPhase });
      setRadioAdminMsg(
        twoPhase
          ? replaceTopic
            ? "Phase 1/2: replacing feed and ingesting text (Stage 1 + Spanish) — keep this tab open…"
            : "Phase 1/2: ingesting text (Stage 1 + Spanish) — keep this tab open…"
          : "Running dry run (no writes)…"
      );
      const ingestStarted = Date.now();
      const r = await fetch("/api/newspaper?radio=ingest", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          dryRun,
          topicSlug: "tech",
          replaceTopic,
          debugTrace,
          skipTts: twoPhase,
          levels: buildLevelOverridesBody(),
        }),
      });
      log("response", { status: r.status, ok: r.ok });
      const rawText = await r.text();
      let j = {};
      try {
        j = rawText ? JSON.parse(rawText) : {};
      } catch {
        j = { parseError: true, rawSnippet: rawText.slice(0, 500) };
      }
      if (!r.ok) {
        if (j.parseError && j.rawSnippet) {
          setRadioAdminMsg(
            `Request failed (HTTP ${r.status}). Response was not JSON — often a gateway timeout or HTML error page.\n\nFirst 500 chars:\n${j.rawSnippet}`
          );
          setRadioAdminTech(rawText.slice(0, 8000));
        } else {
          setRadioAdminMsg(summarizeRadioIngestFailure(j, r.status));
          setRadioAdminTech(JSON.stringify(j, null, 2));
        }
        return;
      }
      if (j.dryRun) {
        let msg = `Dry run: would insert ${j.wouldInsert ?? "?"} stor${Number(j.wouldInsert) === 1 ? "y" : "ies"}${
          j.replaceTopicOnIngest ? " (current feed would be deleted first)" : ""
        }.`;
        if (j.note) msg += `\n${j.note}`;
        setRadioAdminMsg(msg);
        if (debugTrace) setRadioAdminTech(JSON.stringify(j, null, 2));
        return;
      }
      const inserted = j.inserted ?? 0;
      const ingestSec = ((Date.now() - ingestStarted) / 1000).toFixed(0);
      const okLines = [
        `Phase 1/2 done (${ingestSec}s). Inserted ${inserted} stor${inserted === 1 ? "y" : "ies"}.`,
      ];
      if (j.note) okLines.push(j.note);

      if (twoPhase && inserted > 0) {
        setRadioAdminMsg(
          `${okLines.join("\n")}\nPhase 2/2: generating per-sentence audio (TTS)…`
        );
        log("POST /api/newspaper?radio=backfill-tts");
        const tfStart = Date.now();
        const rTts = await fetch("/api/newspaper?radio=backfill-tts", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ topicSlug: "tech", limit: Math.max(40, inserted * 4) }),
        });
        const rawTts = await rTts.text();
        let jt = {};
        try {
          jt = rawTts ? JSON.parse(rawTts) : {};
        } catch {
          jt = { parseError: true, rawSnippet: rawTts.slice(0, 500) };
        }
        const ttsSec = ((Date.now() - tfStart) / 1000).toFixed(0);
        if (!rTts.ok) {
          okLines.push(
            `Phase 2/2 failed (${ttsSec}s, HTTP ${rTts.status}): ${
              jt.error || (jt.rawSnippet ? jt.rawSnippet.slice(0, 200) : "no error body")
            }. Click "Backfill missing audio" to retry TTS only.`
          );
          setRadioAdminTech(
            JSON.stringify({ phase1: j, phase2: jt || rawTts.slice(0, 4000) }, null, 2)
          );
        } else {
          okLines.push(
            `Phase 2/2 done (${ttsSec}s). Audio updated for ${jt.updated ?? 0} level row(s) (${jt.attempted ?? 0} attempted).`
          );
          if (Array.isArray(jt.errors) && jt.errors.length) {
            okLines.push(`Phase 2/2 partial: ${jt.errors.length} row(s) failed TTS; retry with "Backfill missing audio".`);
          }
          if (debugTrace) {
            setRadioAdminTech(JSON.stringify({ phase1: j, phase2: jt }, null, 2));
          }
        }
      } else if (twoPhase) {
        okLines.push("Phase 2/2 skipped (no new rows to generate audio for).");
      } else if (j.enableTts === false) {
        okLines.push(
          "Audio was not generated on this run. Use Advanced → Backfill TTS."
        );
      }

      if (j.levelConstraintCheck === "skipped_no_direct_db_url") {
        okLines.push(
          "If you ever see database errors about “level” checks, run migration 010 in Supabase or set DATABASE_URL."
        );
      }
      setRadioAdminMsg(okLines.join("\n"));
      if (debugTrace && !radioAdminTech) {
        setRadioAdminTech(JSON.stringify(j, null, 2));
      }
    } catch (e) {
      const name = e?.name || "";
      const msg = e?.message || String(e);
      log("catch", { name, msg });
      setRadioAdminMsg(
        `Request error: ${msg}\n\nIf this is a network/CORS issue, open DevTools → Network and retry. If the server hit its time limit, check Vercel logs for 504 / FUNCTION_INVOCATION_TIMEOUT.`
      );
    } finally {
      setRadioAdminBusy(false);
      log("done");
    }
  };

  const runRadioBackfillTtsAdmin = async () => {
    setRadioAdminBusy(true);
    setRadioAdminMsg("");
    setRadioAdminTech("");
    try {
      const token = await getAccessToken();
      if (!token) {
        setRadioAdminMsg(
          "No session: sign in via the main app (Supabase) in this browser, then try again."
        );
        return;
      }
      const r = await fetch("/api/newspaper?radio=backfill-tts", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ topicSlug: "tech", limit: 40 }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setRadioAdminMsg(typeof j.error === "string" ? j.error : "Backfill failed.");
        setRadioAdminTech(JSON.stringify(j, null, 2));
        return;
      }
      setRadioAdminMsg(
        `Backfill: updated ${j.updated ?? 0} level row(s) (${j.attempted ?? 0} attempted).${j.note ? ` ${j.note}` : ""}`
      );
    } catch (e) {
      setRadioAdminMsg(e.message || String(e));
    } finally {
      setRadioAdminBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#FFF9ED] text-stone-900 font-sans pb-32 selection:bg-rose-300">
      <audio ref={audioRef} className="hidden" playsInline />

      <nav className="bg-amber-300 border-b-4 border-stone-900 px-3 md:px-6 py-2 md:py-4 flex justify-between items-center sticky top-0 z-50 shadow-[0_4px_0_0_rgba(28,25,23,1)]">
        <div className="flex items-center gap-1.5 text-stone-900 font-black text-lg md:text-2xl tracking-tighter uppercase italic">
          <Radio className="w-5 h-5 md:w-8 md:h-8" />
          <span className="hidden xs:inline">Radio Zumo</span>
          <span className="xs:hidden">Zumo</span>
        </div>

        <div className="flex items-center gap-2 md:gap-4">
          <div className="hidden sm:flex items-center gap-1 rounded-full border-2 border-stone-900 bg-white px-2 py-1 text-[10px] md:text-xs font-black shadow-[2px_2px_0_0_rgba(28,25,23,1)]">
            <span className="text-stone-500">Racha</span>
            <span>{streak}d</span>
          </div>

          <div className="relative">
            <GraduationCap className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-stone-900 z-10 pointer-events-none" />
            <select
              value={difficulty}
              onChange={(e) => {
                const v = e.target.value;
                if (session?.topic?.feedTopic) {
                  swapDifficultyWhilePlaying(v);
                } else {
                  setDifficulty(v);
                }
              }}
              className="pl-6 pr-6 py-1.5 bg-white border-2 border-stone-900 rounded-full font-black text-[10px] md:text-sm appearance-none cursor-pointer shadow-[2px_2px_0_0_rgba(28,25,23,1)] focus:outline-none"
            >
              {DIFFICULTIES.map((level) => (
                <option key={level} value={level}>
                  {level}
                </option>
              ))}
            </select>
            <ChevronDown className="w-3 h-3 absolute right-1.5 top-1/2 -translate-y-1/2 pointer-events-none text-stone-900" />
          </div>

          <div className="relative hidden md:block">
            <Globe2 className="w-4 h-4 absolute left-2 top-1/2 -translate-y-1/2 text-stone-900 z-10 pointer-events-none" />
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              className="pl-7 pr-8 py-2 bg-white border-2 border-stone-900 rounded-full font-bold text-sm appearance-none cursor-pointer shadow-[2px_2px_0_0_rgba(28,25,23,1)] focus:outline-none"
            >
              {LANGUAGES.map((lang) => (
                <option key={lang} value={lang}>
                  {lang}
                </option>
              ))}
            </select>
          </div>

          <a
            href="../index.html"
            className="text-[10px] md:text-sm font-black bg-white border-2 border-stone-900 px-3 md:px-4 py-1.5 rounded-full shadow-[2px_2px_0_0_rgba(28,25,23,1)] hover:bg-rose-200 transition-colors no-underline text-stone-900 inline-block"
          >
            ¡Entrar!
          </a>
        </div>
      </nav>

      <main className="max-w-6xl mx-auto px-4 md:px-6 py-4 md:py-12">
        <div className="text-center mb-6 md:mb-16 max-w-5xl mx-auto">
          <h1 className="hidden md:block text-7xl font-black tracking-tight mb-8 leading-tight">
            Learn with{" "}
            <span className="text-rose-500 inline-block transform rotate-2">sabor.</span>
          </h1>

          <div className="hidden md:block bg-white p-6 rounded-[2rem] border-4 border-stone-900 shadow-[8px_8px_0_0_rgba(28,25,23,1)] text-left max-w-2xl mx-auto">
            <label className="block text-sm font-black uppercase tracking-wider mb-4">
              My Proficiency Level
            </label>
            <div className="grid grid-cols-5 gap-2">
              {DIFFICULTIES.map((level) => (
                <button
                  key={level}
                  type="button"
                  onClick={() => {
                    if (session?.topic?.feedTopic) {
                      swapDifficultyWhilePlaying(level);
                    } else {
                      setDifficulty(level);
                    }
                  }}
                  className={`py-3 md:py-4 rounded-xl border-2 border-stone-900 font-black text-base md:text-lg transition-all ${
                    difficulty === level
                      ? "bg-amber-400 shadow-none translate-y-1"
                      : "bg-white shadow-[3px_3px_0_0_rgba(28,25,23,1)]"
                  }`}
                >
                  {level}
                </button>
              ))}
              <button
                type="button"
                className="flex flex-col items-center justify-center p-1 rounded-xl border-2 border-stone-900 border-dashed bg-stone-50 hover:bg-teal-50 transition-all font-black"
              >
                <ClipboardCheck className="w-5 h-5 text-teal-600" />
                <span className="text-[10px] uppercase mt-0.5">Test</span>
              </button>
            </div>
          </div>
        </div>

        <h2 className="text-lg md:text-3xl font-black mb-4 md:mb-8 flex items-center gap-2">
          <Music className="w-5 h-5 md:w-8 md:h-8 text-teal-500" />
          Elige tu rollo
        </h2>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-6">
          {TOPICS.map((topic, i) => {
            const TopicIcon = topic.icon;
            return (
              <button
                key={topic.id}
                type="button"
                onClick={() => handleExpand(topic)}
                className={`group flex flex-col items-start p-3 md:p-6 rounded-[1.25rem] md:rounded-[2rem] border-[3px] md:border-4 border-stone-900 transition-all text-left relative bg-white shadow-[4px_4px_0_0_rgba(28,25,23,1)] md:shadow-[6px_6px_0_0_rgba(28,25,23,1)] ${
                  i % 2 === 0 ? "hover:-rotate-1" : "hover:rotate-1"
                }`}
              >
                <div className="relative mb-2 md:mb-6">
                  <div
                    className={`p-2 md:p-4 rounded-xl border-2 border-stone-900 shadow-[1.5px_1.5px_0_0_rgba(28,25,23,1)] ${topic.bg}`}
                  >
                    <TopicIcon className="w-5 h-5 md:w-10 md:h-10" />
                  </div>
                  <div className="absolute -bottom-1 -right-1 bg-white border-2 border-stone-900 rounded-md px-1 py-0.5 text-[7px] md:text-[10px] font-black shadow-[1px_1px_0_0_rgba(28,25,23,1)]">
                    {topic.duration}
                  </div>
                </div>

                <h3 className="text-xs md:text-2xl font-black leading-tight mb-1 truncate w-full">
                  {topic.title}
                </h3>
                <p className="text-[8px] md:text-[10px] font-black text-stone-500 uppercase tracking-widest mt-auto opacity-70">
                  {topic.feedTopic ? "Tap para episodios" : "Tap to config"}
                </p>
              </button>
            );
          })}
        </div>

        {showRadioAdminUi && (
          <div className="mt-8 max-w-2xl mx-auto border-4 border-stone-900 rounded-2xl bg-stone-100 p-4 shadow-[4px_4px_0_0_rgba(28,25,23,1)]">
            <h3 className="font-black text-sm text-stone-900">Radio — refresh the feed</h3>
            <p className="text-[11px] text-stone-700 mt-2 font-bold leading-snug">
              This deletes the current tech feed in the database (including learner progress for those stories),
              fetches fresh articles, and writes new rows. For audio on each sentence, the server needs{" "}
              <code className="bg-white px-1 rounded border border-stone-900">RADIO_ENABLE_TTS=1</code> and your
              xAI key. Can take several minutes.
            </p>

            <details className="mt-4 border-2 border-stone-900 rounded-xl bg-white/80 p-3">
              <summary className="font-black cursor-pointer text-xs text-stone-900">
                Niveles ({activeLevelCount}/{levelConfig.length} activos)
              </summary>
              <p className="text-[10px] text-stone-600 mt-2 font-bold leading-snug">
                Tick a level to include it in this ingest. Expand a row to view or edit the
                exact instruction Grok receives for that level. Changes apply to this ingest
                only (defaults live in code).
              </p>
              <ul className="mt-3 space-y-2">
                {levelConfig.map((L, i) => {
                  const isExpanded = expandedLevelIdx === i;
                  const def = DEFAULT_LEVELS.find((d) => d.level === L.level);
                  const wordBand = /\(([^)]*words?\s+per\s+line[^)]*)\)/i.exec(L.prompt);
                  const isEdited = def && def.defaultPrompt !== L.prompt;
                  return (
                    <li
                      key={L.level}
                      className="border-2 border-stone-900 rounded-lg bg-white px-2 py-1.5"
                    >
                      <div className="flex items-center gap-2">
                        <label className="flex items-center gap-2 text-xs font-black text-stone-900 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={L.enabled}
                            onChange={(e) =>
                              setLevelConfig((prev) =>
                                prev.map((row, j) =>
                                  j === i ? { ...row, enabled: e.target.checked } : row
                                )
                              )
                            }
                            className="rounded border-stone-900"
                          />
                          Nivel {L.level} — {L.cefr}
                        </label>
                        {wordBand && (
                          <span className="text-[10px] text-stone-500 font-bold truncate">
                            {wordBand[1]}
                          </span>
                        )}
                        {isEdited && (
                          <span className="text-[9px] font-black text-amber-700 bg-amber-100 border border-amber-700 rounded px-1">
                            editado
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedLevelIdx((prev) => (prev === i ? null : i))
                          }
                          className="ml-auto text-[10px] font-black text-stone-700 underline"
                        >
                          {isExpanded ? "Ocultar" : "Ver instrucción"}
                        </button>
                      </div>
                      {isExpanded && (
                        <div className="mt-2">
                          <textarea
                            value={L.prompt}
                            onChange={(e) =>
                              setLevelConfig((prev) =>
                                prev.map((row, j) =>
                                  j === i ? { ...row, prompt: e.target.value } : row
                                )
                              )
                            }
                            rows={3}
                            className="w-full font-mono text-[11px] leading-snug border-2 border-stone-900 rounded-md p-2 bg-stone-50"
                          />
                          <div className="flex justify-end mt-1">
                            <button
                              type="button"
                              onClick={() =>
                                setLevelConfig((prev) =>
                                  prev.map((row, j) =>
                                    j === i && def
                                      ? { ...row, prompt: def.defaultPrompt }
                                      : row
                                  )
                                )
                              }
                              disabled={!isEdited}
                              className="text-[10px] font-black text-stone-700 underline disabled:opacity-40"
                            >
                              Restablecer
                            </button>
                          </div>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </details>

            {ingestBlockedByLevels && (
              <p className="mt-3 text-[11px] font-black text-red-700">
                Selecciona al menos un nivel.
              </p>
            )}

            <button
              type="button"
              disabled={radioAdminBusy || ingestBlockedByLevels}
              onClick={() =>
                runRadioIngestAdmin({
                  dryRun: false,
                  replaceTopic: true,
                  debugTrace: ingestDebugTrace,
                })
              }
              className="mt-4 w-full text-sm font-black bg-orange-500 text-white border-2 border-stone-900 px-4 py-3 rounded-xl shadow-[3px_3px_0_0_rgba(28,25,23,1)] disabled:opacity-50"
            >
              {radioAdminBusy ? "Working…" : "Replace feed & generate audio"}
            </button>
            <details className="mt-4 border-2 border-stone-900 rounded-xl bg-white/80 p-3">
              <summary className="font-black cursor-pointer text-xs text-stone-900">Advanced</summary>
              <label className="mt-3 flex items-center gap-2 text-[11px] font-bold text-stone-800 cursor-pointer">
                <input
                  type="checkbox"
                  checked={ingestDebugTrace}
                  onChange={(e) => setIngestDebugTrace(e.target.checked)}
                  className="rounded border-stone-900"
                />
                Include technical trace (larger response; use when debugging)
              </label>
              <div className="flex flex-wrap gap-2 mt-3">
                <button
                  type="button"
                  disabled={radioAdminBusy || ingestBlockedByLevels}
                  onClick={() =>
                    runRadioIngestAdmin({
                      dryRun: true,
                      replaceTopic: true,
                      debugTrace: ingestDebugTrace,
                    })
                  }
                  className="text-xs font-black bg-amber-100 border-2 border-stone-900 px-3 py-2 rounded-lg shadow-[2px_2px_0_0_rgba(28,25,23,1)] disabled:opacity-50"
                >
                  Dry run (replace)
                </button>
                <button
                  type="button"
                  disabled={radioAdminBusy || ingestBlockedByLevels}
                  onClick={() =>
                    runRadioIngestAdmin({
                      dryRun: false,
                      replaceTopic: false,
                      debugTrace: ingestDebugTrace,
                    })
                  }
                  className="text-xs font-black bg-white border-2 border-stone-900 px-3 py-2 rounded-lg shadow-[2px_2px_0_0_rgba(28,25,23,1)] disabled:opacity-50"
                >
                  Append only (no delete)
                </button>
                <button
                  type="button"
                  disabled={radioAdminBusy}
                  onClick={() => runRadioBackfillTtsAdmin()}
                  className="text-xs font-black bg-teal-200 border-2 border-stone-900 px-3 py-2 rounded-lg shadow-[2px_2px_0_0_rgba(28,25,23,1)] disabled:opacity-50"
                >
                  Backfill missing audio
                </button>
              </div>
              <p className="text-[10px] text-stone-600 mt-2 font-bold leading-snug">
                Env: <code className="bg-stone-100 px-1 rounded">RADIO_ADMIN_EMAILS</code>,{" "}
                <code className="bg-stone-100 px-1 rounded">XAI_API_KEY</code>,{" "}
                <code className="bg-stone-100 px-1 rounded">VITE_RADIO_ADMIN_UI=0</code> to hide this panel at build time.
                Faster ingest: <code className="bg-stone-100 px-1 rounded">RADIO_INGEST_FAST=1</code> (then Backfill TTS),{" "}
                <code className="bg-stone-100 px-1 rounded">RADIO_INGEST_STORY_TARGET=1</code>,{" "}
                <code className="bg-stone-100 px-1 rounded">RADIO_TTS_INGEST_CONCURRENCY</code> (default 8; lower if 429s).
              </p>
            </details>
            {(radioAdminMsg || radioAdminTech) && (
              <div className="mt-4 space-y-2">
                {radioAdminMsg && (
                  <p className="text-[12px] font-bold text-stone-900 whitespace-pre-wrap border-2 border-stone-900 rounded-lg bg-white p-3 leading-snug">
                    {radioAdminMsg}
                  </p>
                )}
                {radioAdminTech && (
                  <details className="text-[11px]">
                    <summary className="cursor-pointer font-black text-stone-700">Technical details</summary>
                    <pre className="mt-2 text-[10px] font-mono bg-white border-2 border-stone-900 rounded-lg p-2 overflow-x-auto whitespace-pre-wrap max-h-64 overflow-y-auto">
                      {radioAdminTech}
                    </pre>
                  </details>
                )}
              </div>
            )}
          </div>
        )}
      </main>

      {expandedTopic && (() => {
        const ExpandedIcon = expandedTopic.icon;
        const useFeed = Boolean(expandedTopic.feedTopic);
        const rows = useFeed
          ? feedStories.map((s) => ({ key: s.id, label: s.title, story: s }))
          : expandedTopic.news.map((n) => ({ key: n, label: n, story: null }));

        return (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
            <div
              role="presentation"
              className="absolute inset-0 bg-stone-900/40 backdrop-blur-sm"
              onClick={() => setExpandedTopic(null)}
              onKeyDown={(e) => e.key === "Escape" && setExpandedTopic(null)}
            />
            <div className="relative w-full max-w-2xl bg-white border-4 border-stone-900 rounded-[1.5rem] md:rounded-[2.5rem] shadow-[8px_8px_0_0_rgba(28,25,23,1)] overflow-hidden flex flex-col max-h-[85vh]">
              <div
                className={`p-4 md:p-6 border-b-4 border-stone-900 flex justify-between items-center ${expandedTopic.bg}`}
              >
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-white border-2 border-stone-900 rounded-lg">
                    <ExpandedIcon className="w-5 h-5" />
                  </div>
                  <h3 className="text-base md:text-2xl font-black">{expandedTopic.title}</h3>
                </div>
                <button type="button" onClick={() => setExpandedTopic(null)} aria-label="Close">
                  <X className="w-6 h-6 md:w-8 md:h-8" />
                </button>
              </div>

              <div className="p-4 md:p-6 overflow-y-auto">
                {useFeed && feedLoading && (
                  <p className="font-bold text-sm text-stone-600">Cargando episodios…</p>
                )}
                {useFeed && feedError && (
                  <p className="font-bold text-sm text-red-600">{feedError}</p>
                )}
                {useFeed && !feedLoading && !feedError && rows.length === 0 && (
                  <p className="font-bold text-sm text-stone-600">
                    Aún no hay episodios en Supabase para este tema. Inicia una ingesta desde el panel admin.
                  </p>
                )}
                <div className="space-y-2">
                  {rows.map((row) => (
                    <label
                      key={row.key}
                      className="flex items-center justify-between p-3 bg-[#FFF9ED] border-2 border-stone-900 rounded-xl cursor-pointer"
                    >
                      <span className="font-bold text-xs md:text-lg pr-4">
                        {row.label}
                      </span>
                      <input
                        type="checkbox"
                        checked={selectedNews[expandedTopic.id]?.[row.key] ?? true}
                        onChange={() => toggleNewsItem(expandedTopic.id, row.key)}
                        className="w-5 h-5 md:w-6 md:h-6 accent-teal-400 border-2 border-stone-900"
                      />
                    </label>
                  ))}
                </div>
              </div>

              <div className="p-4 bg-stone-50 border-t-4 border-stone-900">
                <button
                  type="button"
                  onClick={startBroadcast}
                  disabled={useFeed && (feedLoading || rows.length === 0)}
                  className="w-full bg-rose-500 disabled:opacity-50 text-white font-black py-3 rounded-xl border-4 border-stone-900 shadow-[4px_4px_0_0_rgba(28,25,23,1)] flex items-center justify-center gap-2 text-sm md:text-xl"
                >
                  Start Broadcast <ArrowRight className="w-4 h-4 md:w-6 md:h-6" />
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {session && session.phase === "bridge" && currentStory && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-stone-900/70">
          <div className="w-full max-w-lg bg-white border-4 border-stone-900 rounded-3xl p-6 shadow-[8px_8px_0_0_rgba(28,25,23,1)]">
            <p className="text-xs font-black uppercase text-teal-600 mb-2">Pausa (30s)</p>
            <p className="text-3xl font-black mb-4">{Math.ceil(bridgeLeftMs / 1000)}s</p>
            {bridgeMcq ? (
              <>
                <p className="font-bold mb-3">{bridgeMcq.question_en}</p>
                <div className="space-y-2 mb-4">
                  {bridgeMcq.options.map((opt, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => setBridgePick(idx)}
                      className={`w-full text-left p-3 rounded-xl border-2 border-stone-900 font-bold ${
                        bridgePick === idx ? "bg-amber-300" : "bg-[#FFF9ED]"
                      }`}
                    >
                      {opt}
                    </button>
                  ))}
                </div>
                {bridgePick != null && bridgePick !== bridgeMcq.correct && (
                  <p className="text-sm text-rose-600 font-bold mb-2">Not quite — try another.</p>
                )}
                {bridgePick != null && bridgePick === bridgeMcq.correct && (
                  <p className="text-sm text-teal-700 font-bold mb-2">Nice.</p>
                )}
              </>
            ) : (
              <p className="font-bold text-stone-600 mb-4">
                Respira. Siguiente episodio en breve.
              </p>
            )}
            <button
              type="button"
              onClick={submitBridge}
              className="w-full bg-stone-900 text-white font-black py-3 rounded-xl border-2 border-stone-900"
            >
              Saltar pausa
            </button>
          </div>
        </div>
      )}

      {session && session.phase === "playing" && currentStory && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 w-[95%] max-w-3xl z-[65] bg-white border-4 border-stone-900 rounded-2xl shadow-[6px_6px_0_0_rgba(28,25,23,1)] max-h-[85vh] flex flex-col overflow-hidden">
          <div className="flex-shrink-0 bg-white border-b-2 border-stone-200 px-3 pt-2.5 pb-2.5 md:px-4 md:pt-3 md:pb-3">
            <div className="flex min-w-0 items-start justify-between gap-2 md:gap-3">
              <div className="min-w-0 flex-1 text-left pr-1">
                <p className="text-[8px] md:text-[10px] font-black text-teal-600 uppercase tracking-widest leading-tight">
                  {session.topic?.title || (hasAnySentenceAudio ? "Frase a frase" : "Lectura")}
                  <span className="ml-1.5 text-stone-400 tracking-normal font-bold">
                    {session.index + 1}/{session.queue.length}
                  </span>
                </p>
                <h4 className="mt-0.5 text-sm md:text-lg font-black text-stone-900 leading-snug break-words">
                  {currentStory?.title || "Listo"}
                </h4>
              </div>
              <button
                type="button"
                onClick={stopSession}
                aria-label="Cerrar"
                className="h-9 w-9 md:h-10 md:w-10 shrink-0 flex items-center justify-center self-start rounded-full border-2 border-stone-900 bg-stone-100 shadow-[2px_2px_0_0_rgba(28,25,23,1)] active:translate-y-px"
              >
                <X className="w-4 h-4 text-stone-900 md:w-[18px] md:h-[18px]" strokeWidth={2.5} />
              </button>
            </div>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto px-3 pb-3 md:px-4">
          {sentencesList.length > 0 && (
            <div className="mb-4 space-y-3 pt-3">
              {sentencesList.map((sent, i) => {
                const isActive = sentenceIndex === i;
                return (
                  <div
                    key={`${currentStory.id}-sent-${i}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => {
                      if (sent.audioUrl) replaySentence(i);
                      else setSentenceIndex(i);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        if (sent.audioUrl) replaySentence(i);
                        else setSentenceIndex(i);
                      }
                    }}
                    ref={(el) => {
                      sentenceCardRefs.current[i] = el;
                    }}
                    className={`relative rounded-xl border-2 p-3 md:p-4 transition-colors cursor-pointer select-none ${
                      isActive
                        ? "border-amber-500 bg-amber-50 shadow-[3px_3px_0_0_rgba(28,25,23,1)]"
                        : "border-stone-200 bg-[#FFF9ED]"
                    }`}
                  >
                    <span
                      className={`pointer-events-none absolute right-1 top-0.5 text-[5px] leading-none font-medium tabular-nums select-none tracking-tight ${
                        !sent.audioUrl ? "text-rose-400/70" : "text-stone-300/90"
                      }`}
                      aria-hidden
                      title={!sent.audioUrl ? "Sin audio" : undefined}
                    >
                      {i + 1}
                    </span>
                    <WordStackLine
                      sentenceText={sent.text}
                      wordGlossesEn={sent.wordGlossesEn}
                      glossVisibility={glossVisibilityAll}
                    />
                  </div>
                );
              })}
            </div>
          )}
          {currentStory.englishSource && (
            <div className="mb-4">
              <details className="text-xs border-t-2 border-stone-200 pt-2">
                <summary className="cursor-pointer font-black text-stone-600">English source</summary>
                <p className="mt-2 text-stone-600 leading-relaxed whitespace-pre-wrap">
                  {currentStory.englishSource}
                </p>
              </details>
            </div>
          )}
          <p className="text-[10px] font-black uppercase text-stone-500 mb-2">
            Palabras clave (tap)
          </p>
          <div className="flex flex-wrap gap-2 mb-3">
            {(currentStory.meta?.hard_words || []).map((w) => (
              <button
                key={w.term}
                type="button"
                onClick={() =>
                  setExpandedWord((prev) => (prev === w.term ? null : w.term))
                }
                className={`px-2 py-1 rounded-lg border-2 border-stone-900 text-xs font-black ${
                  expandedWord === w.term ? "bg-amber-300" : "bg-[#FFF9ED]"
                }`}
              >
                {w.term}
              </button>
            ))}
          </div>
          {expandedWord && (
            <p className="text-sm font-bold text-stone-700 mb-2">
              {
                (currentStory.meta?.hard_words || []).find((w) => w.term === expandedWord)
                  ?.gloss_en
              }
            </p>
          )}
          </div>
          <div className="flex-shrink-0 border-t-2 border-stone-200 bg-stone-50/90 px-3 py-2 md:px-4 md:py-2.5">
            <div className="flex flex-col gap-2">
              <div className="flex w-full min-w-0 items-center gap-2">
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      if (session.phase === "playing" && currentStory && !hasAnySentenceAudio) {
                        afterStoryFinished();
                        return;
                      }
                      handleSentenceTap();
                    }}
                    className="h-11 w-11 md:h-12 md:w-12 flex shrink-0 items-center justify-center rounded-full border-[3px] border-stone-900 transition-all bg-rose-500 shadow-[2px_2px_0_0_rgba(28,25,23,1)]"
                    aria-label={
                      session.phase === "playing" && currentStory && !hasAnySentenceAudio
                        ? "Marcar como leído"
                        : "Play or pause"
                    }
                  >
                    {session.phase === "playing" && currentStory && !hasAnySentenceAudio ? (
                      <CheckCircle className="text-stone-900 w-5 h-5 md:w-6 md:h-6" />
                    ) : audioRef.current && !audioRef.current.paused ? (
                      <Pause className="text-stone-900 fill-current w-5 h-5 md:w-6 md:h-6" />
                    ) : (
                      <Play className="text-stone-900 fill-current w-5 h-5 md:w-6 md:h-6 ml-0.5" />
                    )}
                  </button>
                  {hasAnySentenceAudio && (
                    <div className="relative shrink-0">
                      <div className="flex shrink-0 items-center gap-1.5 rounded-lg border-2 border-stone-200 bg-white py-1 pl-1.5 pr-1.5">
                        <button
                          type="button"
                          onClick={() => autoContinueAudio && setAutoContinueMenuOpen((v) => !v)}
                          className="text-[10px] md:text-[11px] font-bold text-stone-700 whitespace-nowrap focus:outline-none"
                          aria-haspopup="menu"
                          aria-expanded={autoContinueMenuOpen}
                          title={autoContinueAudio ? "Pausa entre frases" : "Auto-play"}
                        >
                          Auto-play
                          {autoContinueAudio ? (
                            <span className="ml-1 text-stone-500 font-semibold">
                              {autoContinueDelayMs}ms
                            </span>
                          ) : null}
                        </button>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={autoContinueAudio}
                          onClick={() => {
                            setAutoContinueAudio((v) => {
                              const next = !v;
                              if (!next) setAutoContinueMenuOpen(false);
                              return next;
                            });
                          }}
                          className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border-2 border-stone-900 transition-colors focus:outline-none focus:ring-2 focus:ring-amber-500 ${
                            autoContinueAudio ? "bg-teal-400" : "bg-stone-200"
                          }`}
                        >
                          <span
                            className={`inline-block h-4 w-4 transform rounded-full bg-white border-2 border-stone-900 transition-transform ${
                              autoContinueAudio ? "translate-x-5" : "translate-x-0.5"
                            }`}
                          />
                        </button>
                      </div>
                      {autoContinueAudio && autoContinueMenuOpen && (
                        <div
                          role="menu"
                          className="absolute left-0 bottom-full z-20 mb-1 flex flex-col gap-0.5 rounded-lg border-2 border-stone-900 bg-white p-1 shadow-lg"
                        >
                          <span className="px-2 py-0.5 text-[9px] font-black uppercase tracking-wide text-stone-500">
                            Pausa
                          </span>
                          {AUTO_NEXT_DELAY_OPTIONS_MS.map((ms) => {
                            const active = ms === autoContinueDelayMs;
                            return (
                              <button
                                key={ms}
                                type="button"
                                role="menuitemradio"
                                aria-checked={active}
                                onClick={() => {
                                  setAutoContinueDelayMs(ms);
                                  setAutoContinueMenuOpen(false);
                                }}
                                className={`rounded-md px-3 py-1 text-left text-[11px] font-bold transition-colors ${
                                  active
                                    ? "bg-teal-400 text-stone-900"
                                    : "text-stone-700 hover:bg-stone-100"
                                }`}
                              >
                                {ms}ms
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
                {sentencesList.length > 0 && (
                  <div
                    className={`flex min-h-11 min-w-0 flex-1 items-center gap-2 pl-0.5 ${
                      articleTtsDebugPayload ? "justify-between" : "justify-end"
                    }`}
                  >
                    {articleTtsDebugPayload ? (
                      <button
                        type="button"
                        aria-label="TTS artículo (depuración)"
                        aria-expanded={articleTtsDebugOpen}
                        className={`h-10 w-10 shrink-0 flex items-center justify-center rounded-lg border-2 border-stone-800 text-stone-800 focus:outline-none focus:ring-2 focus:ring-amber-500 active:translate-y-px ${
                          articleTtsDebugOpen
                            ? "bg-amber-200"
                            : "bg-white hover:bg-amber-100"
                        }`}
                        onClick={() => setArticleTtsDebugOpen((v) => !v)}
                      >
                        <Bug className="h-5 w-5" strokeWidth={2.5} />
                      </button>
                    ) : null}
                    <button
                      type="button"
                      aria-label="Mostrar traducciones de palabras (todas las frases)"
                      className="h-10 w-10 shrink-0 flex items-center justify-center rounded-lg border-2 border-stone-800 text-stone-800 bg-white hover:bg-amber-100 focus:outline-none focus:ring-2 focus:ring-amber-500 active:translate-y-px"
                      onClick={flashAllGlosses}
                    >
                      <Eye className="h-5 w-5" strokeWidth={2.5} />
                    </button>
                  </div>
                )}
              </div>
              {articleTtsDebugOpen && articleTtsDebugPayload ? (
                <pre
                  className="w-full text-[8px] md:text-[9px] leading-relaxed font-mono text-stone-500 bg-white rounded-md px-2 py-1.5 overflow-x-auto overflow-y-auto whitespace-pre-wrap max-h-32 border border-stone-100"
                  onClick={(e) => e.stopPropagation()}
                >
                  {JSON.stringify(articleTtsDebugPayload, null, 2)}
                </pre>
              ) : null}
            </div>
          </div>
        </div>
      )}

      <div
        className={`fixed bottom-4 left-1/2 -translate-x-1/2 w-[95%] max-w-4xl bg-stone-900 rounded-[1.25rem] md:rounded-[2rem] p-3 md:p-6 transition-all duration-500 z-50 shadow-[0_6px_0_0_rgba(20,18,16,1)] ${
          session && session.phase !== "playing"
            ? "translate-y-0"
            : "translate-y-[250%]"
        }`}
      >
        <div className="flex flex-row items-center gap-3 flex-wrap">
          {session?.topic &&
            session.phase !== "playing" &&
            (() => {
              const ActiveIcon = session.topic.icon;
              return (
                <div
                  className={`p-2 md:p-4 rounded-xl border-2 border-stone-900 flex-shrink-0 ${session.topic.bg}`}
                >
                  <ActiveIcon className="w-5 h-5 md:w-8 md:h-8 text-stone-900" />
                </div>
              );
            })()}
          <div className="flex-1 min-w-0 text-left">
            <p className="text-[7px] md:text-xs font-black text-teal-400 uppercase tracking-widest">
              Entre episodios
            </p>
            <h4 className="text-xs md:text-xl font-black text-white truncate">
              {session ? `${currentStory?.title || "Listo"} (${session.index + 1}/${session.queue.length})` : ""}
            </h4>
            <p className="text-[9px] md:text-sm font-bold text-stone-400 uppercase">
              {language} • {difficulty}
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              if (!session) return;
              if (
                session.phase === "playing" &&
                currentStory &&
                !hasAnySentenceAudio
              ) {
                afterStoryFinished();
                return;
              }
              handleSentenceTap();
            }}
            className="w-10 h-10 md:w-16 md:h-16 flex items-center justify-center rounded-full border-[3px] border-stone-900 transition-all bg-rose-500 shadow-[2px_2px_0_0_rgba(28,25,23,1)]"
            aria-label={
              session?.phase === "playing" && currentStory && !hasAnySentenceAudio
                ? "Marcar como leído"
                : "Play or pause"
            }
          >
            {session &&
            session.phase === "playing" &&
            currentStory &&
            !hasAnySentenceAudio ? (
              <CheckCircle className="text-stone-900 w-5 h-5 md:w-8 md:h-8" />
            ) : session &&
              session.phase === "playing" &&
              audioRef.current &&
              !audioRef.current.paused ? (
              <Pause className="text-stone-900 fill-current w-5 h-5 md:w-8 md:h-8" />
            ) : (
              <Play className="text-stone-900 fill-current w-5 h-5 md:w-8 md:h-8 ml-0.5" />
            )}
          </button>
          {session && (
            <button
              type="button"
              onClick={stopSession}
              className="text-[10px] md:text-xs font-black text-white underline"
            >
              Stop
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
