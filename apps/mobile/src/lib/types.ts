export type RadioSentence = {
  text: string;
  audioUrl: string | null;
  wordGlossesEn?: string[] | null;
};

export type RadioStory = {
  id: string;
  title: string;
  level: number;
  createdAt?: string;
  displayBody: string;
  sentences: RadioSentence[];
  durationSec?: number | null;
  meta?: {
    bridge_mcq?: {
      question_en: string;
      options: string[];
      correct: number;
    };
  };
};

export type RadioFeedResponse = {
  topic: string;
  level: number;
  stories: RadioStory[];
};

export type RadioProgressGetResponse = {
  streak: number;
  completed: Array<{ storyId: string; level: number; completedAt: string }>;
};
