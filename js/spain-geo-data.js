/**
 * Schematic Spain map (not survey-accurate). Coordinates in viewBox 0–100 × 0–125.
 * @typedef {{ id: string, label: string, cx: number, cy: number, rx: number, ry: number }} Region
 * @typedef {{ id: string, label: string, cx: number, cy: number, r?: number }} City
 * @typedef {{ id: string, label: string, points: string }} River
 * @typedef {{ id: string, label: string, cx: number, cy: number, rx: number, ry: number }} Range
 */

export const SPAIN_VIEW = { w: 100, h: 125 };

/** Simplified silhouette */
export const OUTLINE_PATH =
  "M18 48 L22 32 L38 22 L58 18 L78 24 L88 38 L90 58 L84 78 L72 98 L52 112 L34 108 L20 88 L16 62 Z";

export const REGIONS = [
  { id: "galicia", label: "Galicia", cx: 22, cy: 32, rx: 12, ry: 14 },
  { id: "asturias", label: "Asturias & Cantabria", cx: 28, cy: 24, rx: 10, ry: 8 },
  { id: "basque", label: "Basque Country & Navarre", cx: 42, cy: 22, rx: 9, ry: 10 },
  { id: "aragon", label: "Aragon", cx: 58, cy: 28, rx: 14, ry: 16 },
  { id: "catalonia", label: "Catalonia", cx: 72, cy: 32, rx: 11, ry: 14 },
  { id: "la_rioja", label: "La Rioja", cx: 44, cy: 30, rx: 5, ry: 5 },
  { id: "castile_leon", label: "Castile and León", cx: 36, cy: 42, rx: 16, ry: 18 },
  { id: "madrid", label: "Community of Madrid", cx: 46, cy: 52, rx: 5, ry: 5 },
  { id: "castile_mancha", label: "Castile-La Mancha", cx: 48, cy: 64, rx: 18, ry: 16 },
  { id: "extremadura", label: "Extremadura", cx: 32, cy: 62, rx: 12, ry: 14 },
  { id: "valencia", label: "Valencia", cx: 62, cy: 58, rx: 12, ry: 12 },
  { id: "murcia", label: "Murcia", cx: 58, cy: 72, rx: 9, ry: 10 },
  { id: "andalusia", label: "Andalusia", cx: 42, cy: 88, rx: 22, ry: 22 },
  { id: "baleares", label: "Balearic Islands (schematic)", cx: 78, cy: 52, rx: 6, ry: 4 },
  { id: "canarias", label: "Canary Islands (schematic)", cx: 18, cy: 108, rx: 10, ry: 6 },
  { id: "ceuta_melilla", label: "Ceuta / Melilla (schematic)", cx: 52, cy: 98, rx: 4, ry: 3 },
];

export const CITIES = [
  { id: "madrid_c", label: "Madrid", cx: 46, cy: 52, r: 2.2 },
  { id: "barcelona", label: "Barcelona", cx: 74, cy: 34, r: 2.2 },
  { id: "valencia_c", label: "Valencia", cx: 64, cy: 56, r: 2 },
  { id: "seville", label: "Seville", cx: 34, cy: 86, r: 2 },
  { id: "zaragoza", label: "Zaragoza", cx: 58, cy: 34, r: 1.8 },
  { id: "malaga", label: "Málaga", cx: 40, cy: 92, r: 1.8 },
  { id: "bilbao", label: "Bilbao", cx: 38, cy: 22, r: 1.8 },
  { id: "santiago", label: "Santiago de Compostela", cx: 20, cy: 34, r: 1.8 },
  { id: "granada", label: "Granada", cx: 48, cy: 90, r: 1.8 },
  { id: "cordoba", label: "Córdoba", cx: 38, cy: 80, r: 1.8 },
  { id: "toledo", label: "Toledo", cx: 44, cy: 58, r: 1.6 },
  { id: "salamanca", label: "Salamanca", cx: 30, cy: 52, r: 1.6 },
  { id: "burgos", label: "Burgos", cx: 40, cy: 38, r: 1.6 },
  { id: "vigo", label: "Vigo", cx: 18, cy: 36, r: 1.6 },
  { id: "santander", label: "Santander", cx: 32, cy: 24, r: 1.6 },
  { id: "alicante", label: "Alicante", cx: 62, cy: 66, r: 1.6 },
  { id: "cadiz", label: "Cádiz", cx: 28, cy: 94, r: 1.6 },
  { id: "pamplona", label: "Pamplona", cx: 44, cy: 24, r: 1.6 },
];

export const RIVERS = [
  { id: "ebro", label: "Ebro", points: "58,38 62,42 56,48 50,44 48,38" },
  { id: "duero", label: "Douro (Duero)", points: "28,48 32,44 36,50 34,58 30,54" },
  { id: "tajo", label: "Tagus (Tajo)", points: "42,58 44,52 48,58 46,68 40,64" },
  { id: "guadalquivir", label: "Guadalquivir", points: "36,82 40,76 44,70 48,78 42,88" },
  { id: "jucar", label: "Júcar", points: "58,62 60,58 62,64 58,70 56,66" },
  { id: "guadiana", label: "Guadiana", points: "28,72 32,68 36,74 34,82 30,78" },
  { id: "mino", label: "Miño", points: "16,38 20,42 22,36 20,32 18,36" },
  { id: "segura", label: "Segura", points: "56,74 58,70 60,76 56,80 54,76" },
];

export const RANGES = [
  { id: "pyrenees", label: "Pyrenees", cx: 62, cy: 20, rx: 18, ry: 6 },
  { id: "sierra_nevada", label: "Sierra Nevada", cx: 50, cy: 92, rx: 10, ry: 6 },
  { id: "cantabrian", label: "Cantabrian Mountains", cx: 28, cy: 26, rx: 14, ry: 5 },
  { id: "iberian_system", label: "Iberian System", cx: 56, cy: 44, rx: 12, ry: 8 },
  { id: "sierra_gredos", label: "Sierra de Gredos", cx: 36, cy: 54, rx: 8, ry: 6 },
  { id: "montes_toledo", label: "Montes de Toledo", cx: 40, cy: 62, rx: 9, ry: 5 },
  { id: "sierra_morena", label: "Sierra Morena", cx: 34, cy: 78, rx: 16, ry: 5 },
];

const COLORS = ["#f97316", "#38bdf8", "#a3e635", "#e879f9"];

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function pickDistractors(all, correctId, n) {
  const rest = all.filter((x) => x.id !== correctId);
  shuffle(rest);
  return rest.slice(0, n);
}

/**
 * @returns {{ prompt: string, layer: 'region'|'city'|'river'|'range', options: { id: string, label: string, color: string }[] }[]}
 */
export function buildQuestionPool() {
  /** @type {{ prompt: string, layer: string, options: { id: string, label: string, color: string }[] }[]} */
  const out = [];

  for (const r of REGIONS) {
    const wrong = pickDistractors(REGIONS, r.id, 3);
    const opts = shuffle([
      { id: r.id, label: r.label, color: "" },
      ...wrong.map((w) => ({ id: w.id, label: w.label, color: "" })),
    ]).map((o, i) => ({ ...o, color: COLORS[i % 4] }));
    out.push({
      prompt: `Where is **${r.label}** on this map? Tap the matching highlight (1–4).`,
      layer: "region",
      correctId: r.id,
      options: opts,
    });
  }

  for (const c of CITIES) {
    const wrong = pickDistractors(CITIES, c.id, 3);
    const opts = shuffle([
      { id: c.id, label: c.label, color: "" },
      ...wrong.map((w) => ({ id: w.id, label: w.label, color: "" })),
    ]).map((o, i) => ({ ...o, color: COLORS[i % 4] }));
    out.push({
      prompt: `Which marker shows **${c.label}**?`,
      layer: "city",
      correctId: c.id,
      options: opts,
    });
  }

  for (const rv of RIVERS) {
    const wrong = pickDistractors(RIVERS, rv.id, 3);
    const opts = shuffle([
      { id: rv.id, label: rv.label, color: "" },
      ...wrong.map((w) => ({ id: w.id, label: w.label, color: "" })),
    ]).map((o, i) => ({ ...o, color: COLORS[i % 4] }));
    out.push({
      prompt: `Which river trace is the **${rv.label}**?`,
      layer: "river",
      correctId: rv.id,
      options: opts,
    });
  }

  for (const m of RANGES) {
    const wrong = pickDistractors(RANGES, m.id, 3);
    const opts = shuffle([
      { id: m.id, label: m.label, color: "" },
      ...wrong.map((w) => ({ id: w.id, label: w.label, color: "" })),
    ]).map((o, i) => ({ ...o, color: COLORS[i % 4] }));
    out.push({
      prompt: `Which highlight is the **${m.label}**?`,
      layer: "range",
      correctId: m.id,
      options: opts,
    });
  }

  // Extra phrasing variants (same ids, new prompts) to enlarge pool
  const extras = [
    { id: "extremadura", prompt: "Tap the autonomous community of **Extremadura**." },
    { id: "andalusia", prompt: "Find **Andalusia** in the south." },
    { id: "catalonia", prompt: "Where is **Catalonia** (northeast)?" },
    { id: "guadalquivir", prompt: "Pick the **Guadalquivir** river." },
    { id: "ebro", prompt: "Which stroke follows the **Ebro** basin (northeast)?" },
    { id: "sierra_nevada", prompt: "Locate **Sierra Nevada** in the south." },
    { id: "pyrenees", prompt: "Which band is the **Pyrenees** border chain?" },
    { id: "santiago", prompt: "Which city is **Santiago de Compostela**?" },
    { id: "madrid_c", prompt: "Tap **Madrid**." },
    { id: "barcelona", prompt: "Tap **Barcelona**." },
  ];

  for (const ex of extras) {
    const inRegions = REGIONS.find((x) => x.id === ex.id);
    const inCities = CITIES.find((x) => x.id === ex.id);
    const inRivers = RIVERS.find((x) => x.id === ex.id);
    const inRanges = RANGES.find((x) => x.id === ex.id);
    let layer = "";
    let all = [];
    if (inRegions) {
      layer = "region";
      all = REGIONS;
    } else if (inCities) {
      layer = "city";
      all = CITIES;
    } else if (inRivers) {
      layer = "river";
      all = RIVERS;
    } else if (inRanges) {
      layer = "range";
      all = RANGES;
    } else continue;
    const wrong = pickDistractors(all, ex.id, 3);
    const base = all.find((x) => x.id === ex.id);
    const opts = shuffle([
      { id: ex.id, label: base.label, color: "" },
      ...wrong.map((w) => ({ id: w.id, label: w.label, color: "" })),
    ]).map((o, i) => ({ ...o, color: COLORS[i % 4] }));
    out.push({ prompt: ex.prompt, layer, correctId: ex.id, options: opts });
  }

  return out;
}
