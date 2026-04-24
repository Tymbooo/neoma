import { useEffect, useMemo, useRef, useState } from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import { Audio, InterruptionModeAndroid, InterruptionModeIOS } from "expo-av";
import { Pause, Play, X } from "lucide-react-native";
import type { RadioStory } from "../lib/types";
import { AUTO_PLAY_DELAYS_MS } from "../lib/levels";
import { WordGlossLine } from "./WordGlossLine";

type Props = {
  story: RadioStory | null;
  visible: boolean;
  autoPlay: boolean;
  autoPlayDelayMs: number;
  onChangeDelay: (delayMs: number) => void;
  onClose: () => void;
  onFinished: () => Promise<void> | void;
};

let audioModeConfigured = false;
async function ensureAudioMode() {
  if (audioModeConfigured) return;
  try {
    await Audio.setAudioModeAsync({
      playsInSilentModeIOS: true,
      staysActiveInBackground: true,
      shouldDuckAndroid: true,
      playThroughEarpieceAndroid: false,
      interruptionModeIOS: InterruptionModeIOS.DoNotMix,
      interruptionModeAndroid: InterruptionModeAndroid.DoNotMix,
    });
    audioModeConfigured = true;
  } catch {
    // Non-fatal; playback can still work in foreground.
  }
}

export function StoryPlayerModal({
  story,
  visible,
  autoPlay,
  autoPlayDelayMs,
  onChangeDelay,
  onClose,
  onFinished,
}: Props) {
  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState<"reading" | "quiz">("reading");
  const [quizPick, setQuizPick] = useState<number | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [revealedIdx, setRevealedIdx] = useState<number | null>(null);
  const soundRef = useRef<Audio.Sound | null>(null);
  const autoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Increments on each lifecycle; callbacks from stale Sound objects compare and bail.
  const generationRef = useRef(0);

  const sentence = story?.sentences[index] ?? null;
  const total = story?.sentences.length ?? 0;

  const canPlayAudio = Boolean(sentence?.audioUrl);
  const isLastSentence = total > 0 && index >= total - 1;
  const bridgeMcq = story?.meta?.bridge_mcq;

  function cancelAutoTimer() {
    if (autoTimerRef.current) {
      clearTimeout(autoTimerRef.current);
      autoTimerRef.current = null;
    }
  }

  async function clearSound() {
    cancelAutoTimer();
    const prev = soundRef.current;
    soundRef.current = null;
    if (prev) {
      try {
        prev.setOnPlaybackStatusUpdate(null);
        await prev.unloadAsync();
      } catch {
        // ignore
      }
    }
    setIsPlaying(false);
  }

  const moveNext = async () => {
    if (!story) return;
    cancelAutoTimer();
    if (index < total - 1) {
      setIndex((v) => v + 1);
      return;
    }
    if (bridgeMcq?.question_en && Array.isArray(bridgeMcq.options) && bridgeMcq.options.length >= 2) {
      setPhase("quiz");
      return;
    }
    await onFinished();
  };

  const playCurrent = async () => {
    if (!sentence?.audioUrl) return;
    await ensureAudioMode();
    await clearSound();
    const myGeneration = ++generationRef.current;
    const { sound } = await Audio.Sound.createAsync(
      { uri: sentence.audioUrl },
      { shouldPlay: true, progressUpdateIntervalMillis: 500 }
    );
    // If another transition fired during createAsync, discard this sound.
    if (myGeneration !== generationRef.current) {
      try {
        sound.setOnPlaybackStatusUpdate(null);
        await sound.unloadAsync();
      } catch {
        // ignore
      }
      return;
    }
    sound.setOnPlaybackStatusUpdate((status) => {
      if (myGeneration !== generationRef.current) return;
      if (!status.isLoaded) return;
      setIsPlaying(status.isPlaying);
      if (status.didJustFinish) {
        if (autoPlay) {
          cancelAutoTimer();
          autoTimerRef.current = setTimeout(() => {
            autoTimerRef.current = null;
            moveNext().catch(() => undefined);
          }, autoPlayDelayMs);
        } else {
          // Reset so the next Play restarts the clip.
          sound.setPositionAsync(0).catch(() => undefined);
          setIsPlaying(false);
        }
      }
    });
    soundRef.current = sound;
  };

  const togglePlay = async () => {
    if (!sentence?.audioUrl) return;
    if (!soundRef.current) {
      await playCurrent();
      return;
    }
    const status = await soundRef.current.getStatusAsync();
    if (!status.isLoaded) return;
    if (status.isPlaying) {
      await soundRef.current.pauseAsync();
      setIsPlaying(false);
    } else {
      await soundRef.current.playAsync();
      setIsPlaying(true);
    }
  };

  useEffect(() => {
    if (!visible) return;
    setIndex(0);
    setPhase("reading");
    setQuizPick(null);
    setRevealedIdx(null);
  }, [visible, story?.id]);

  useEffect(() => {
    if (!visible || phase !== "reading" || !autoPlay || !sentence?.audioUrl) {
      // Stop anything currently playing when auto-play is disabled or we leave reading.
      clearSound().catch(() => undefined);
      return;
    }
    playCurrent().catch(() => undefined);
    return () => {
      clearSound().catch(() => undefined);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, phase, visible, autoPlay, story?.id]);

  useEffect(() => {
    if (!visible) {
      clearSound().catch(() => undefined);
    }
  }, [visible]);

  useEffect(() => {
    return () => {
      clearSound().catch(() => undefined);
    };
  }, []);

  const progressText = useMemo(() => {
    if (!total) return "0/0";
    return `${index + 1}/${total}`;
  }, [index, total]);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: "#F8FAFC" }}>
        <View
          style={{
            paddingTop: 56,
            paddingBottom: 14,
            paddingHorizontal: 16,
            borderBottomWidth: 1,
            borderBottomColor: "#E2E8F0",
            backgroundColor: "#FFFFFF",
            gap: 8,
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <Text style={{ flex: 1, fontSize: 20, fontWeight: "800", color: "#0F172A" }}>{story?.title || "Story"}</Text>
            <Pressable onPress={onClose} hitSlop={8}>
              <X size={24} color="#0F172A" />
            </Pressable>
          </View>
          <Text style={{ color: "#475569", fontWeight: "700" }}>
            {phase === "reading" ? `Sentence ${progressText}` : "Quick recap"}
          </Text>
        </View>

        {phase === "reading" ? (
          <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
            {story?.sentences.map((row, idx) => (
              <View
                key={`${story.id}-${idx}`}
                style={{
                  borderColor: idx === index ? "#0EA5E9" : "#CBD5E1",
                  borderWidth: 2,
                  borderRadius: 14,
                  padding: 12,
                  backgroundColor: idx === index ? "#ECFEFF" : "#FFFFFF",
                  gap: 8,
                }}
              >
                <Text style={{ color: "#0F172A", fontWeight: "700" }}>#{idx + 1}</Text>
                <WordGlossLine
                  sentence={row.text}
                  glosses={row.wordGlossesEn}
                  showGlosses={revealedIdx === idx}
                  onToggleGlosses={() =>
                    setRevealedIdx((prev) => (prev === idx ? null : idx))
                  }
                />
              </View>
            ))}
          </ScrollView>
        ) : (
          <View style={{ flex: 1, padding: 16, gap: 12 }}>
            <View
              style={{
                borderWidth: 2,
                borderColor: "#CBD5E1",
                borderRadius: 14,
                backgroundColor: "#FFFFFF",
                padding: 14,
                gap: 12,
              }}
            >
              <Text style={{ fontSize: 17, fontWeight: "800", color: "#0F172A" }}>
                {bridgeMcq?.question_en || "What did this story emphasize?"}
              </Text>
              {(bridgeMcq?.options || []).map((opt, idx) => (
                <Pressable
                  key={`${opt}-${idx}`}
                  onPress={() => setQuizPick(idx)}
                  style={{
                    borderWidth: 1,
                    borderRadius: 12,
                    borderColor: quizPick === idx ? "#0F172A" : "#CBD5E1",
                    backgroundColor: quizPick === idx ? "#E2E8F0" : "#FFFFFF",
                    paddingVertical: 10,
                    paddingHorizontal: 12,
                  }}
                >
                  <Text style={{ color: "#0F172A", fontWeight: "700" }}>{opt}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        )}

        <View
          style={{
            borderTopWidth: 1,
            borderTopColor: "#E2E8F0",
            backgroundColor: "#FFFFFF",
            paddingHorizontal: 16,
            paddingTop: 10,
            paddingBottom: 24,
            gap: 10,
          }}
        >
          {phase === "reading" ? (
            <>
              {autoPlay ? (
                <>
                  <Text style={{ fontSize: 12, color: "#64748B", fontWeight: "700" }}>
                    Auto-play pause: {autoPlayDelayMs}ms
                  </Text>
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                    {AUTO_PLAY_DELAYS_MS.map((delay) => (
                      <Pressable
                        key={delay}
                        onPress={() => onChangeDelay(delay)}
                        style={{
                          borderWidth: 1,
                          borderColor: delay === autoPlayDelayMs ? "#0F172A" : "#CBD5E1",
                          backgroundColor: delay === autoPlayDelayMs ? "#E2E8F0" : "#FFFFFF",
                          borderRadius: 999,
                          paddingVertical: 6,
                          paddingHorizontal: 10,
                        }}
                      >
                        <Text style={{ fontWeight: "700", color: "#0F172A" }}>{delay}ms</Text>
                      </Pressable>
                    ))}
                  </View>
                </>
              ) : null}

              <View style={{ flexDirection: "row", gap: 10 }}>
                <Pressable
                  onPress={() => {
                    cancelAutoTimer();
                    setIndex((i) => Math.max(0, i - 1));
                  }}
                  style={{
                    flex: 1,
                    paddingVertical: 12,
                    borderRadius: 12,
                    alignItems: "center",
                    borderWidth: 1,
                    borderColor: "#CBD5E1",
                    backgroundColor: "#FFFFFF",
                  }}
                >
                  <Text style={{ fontWeight: "800", color: "#334155" }}>Prev</Text>
                </Pressable>
                <Pressable
                  onPress={togglePlay}
                  disabled={!canPlayAudio}
                  style={{
                    flex: 1,
                    paddingVertical: 12,
                    borderRadius: 12,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: canPlayAudio ? "#F43F5E" : "#E2E8F0",
                  }}
                >
                  {isPlaying ? <Pause color="#0F172A" /> : <Play color="#0F172A" />}
                </Pressable>
                <Pressable
                  onPress={moveNext}
                  style={{
                    flex: 1,
                    paddingVertical: 12,
                    borderRadius: 12,
                    alignItems: "center",
                    borderWidth: 1,
                    borderColor: "#CBD5E1",
                    backgroundColor: "#FFFFFF",
                  }}
                >
                  <Text style={{ fontWeight: "800", color: "#334155" }}>{isLastSentence ? "Finish" : "Next"}</Text>
                </Pressable>
              </View>
            </>
          ) : (
            <Pressable
              onPress={() => onFinished()}
              style={{
                paddingVertical: 12,
                borderRadius: 12,
                alignItems: "center",
                backgroundColor: "#0EA5E9",
              }}
            >
              <Text style={{ color: "#FFFFFF", fontWeight: "800" }}>
                {quizPick == null ? "Skip and complete" : "Complete story"}
              </Text>
            </Pressable>
          )}
        </View>
      </View>
    </Modal>
  );
}
