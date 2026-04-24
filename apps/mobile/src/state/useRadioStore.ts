import { create } from "zustand";
import type { LevelLabel } from "../lib/levels";

type RadioStore = {
  topic: string;
  levelLabel: LevelLabel;
  autoPlay: boolean;
  autoPlayDelayMs: number;
  setTopic: (topic: string) => void;
  setLevelLabel: (level: LevelLabel) => void;
  setAutoPlay: (enabled: boolean) => void;
  setAutoPlayDelayMs: (delay: number) => void;
};

export const useRadioStore = create<RadioStore>((set) => ({
  topic: "tech",
  levelLabel: "B1",
  autoPlay: true,
  autoPlayDelayMs: 100,
  setTopic: (topic) => set({ topic }),
  setLevelLabel: (levelLabel) => set({ levelLabel }),
  setAutoPlay: (autoPlay) => set({ autoPlay }),
  setAutoPlayDelayMs: (autoPlayDelayMs) => set({ autoPlayDelayMs }),
}));
