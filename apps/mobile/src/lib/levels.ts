export const LEVELS = [
  { label: "A1", level: 1 },
  { label: "A2", level: 2 },
  { label: "B1", level: 3 },
  { label: "B2", level: 4 },
  { label: "C1", level: 5 },
  { label: "C2", level: 6 },
] as const;

export type LevelLabel = (typeof LEVELS)[number]["label"];

export const AUTO_PLAY_DELAYS_MS = [0, 100, 200, 300, 400, 500] as const;
