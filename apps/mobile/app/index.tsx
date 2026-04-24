import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LogIn, LogOut, Radio, RefreshCw } from "lucide-react-native";
import { fetchFeed, fetchProgress, postProgress } from "../src/lib/api";
import { LEVELS } from "../src/lib/levels";
import { StoryCard } from "../src/components/StoryCard";
import { useRadioStore } from "../src/state/useRadioStore";
import { StoryPlayerModal } from "../src/components/StoryPlayerModal";
import type { RadioStory } from "../src/lib/types";
import { useAuth } from "../src/providers/AuthProvider";

const TOPICS = [{ key: "tech", label: "Tech News" }] as const;

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const [playerStory, setPlayerStory] = useState<RadioStory | null>(null);
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [sendingOtp, setSendingOtp] = useState(false);

  const {
    topic,
    levelLabel,
    autoPlay,
    autoPlayDelayMs,
    setTopic,
    setAutoPlay,
    setAutoPlayDelayMs,
    setLevelLabel,
  } = useRadioStore();
  const { session, loading, sendOtp, verifyOtp, signOut, isConfigured } = useAuth();

  const level = useMemo(() => LEVELS.find((L) => L.label === levelLabel)?.level ?? 3, [levelLabel]);

  const feedQuery = useQuery({
    queryKey: ["feed", topic, level],
    queryFn: () => fetchFeed(topic, level),
  });

  const progressQuery = useQuery({
    queryKey: ["progress", topic, session?.user?.id || "guest"],
    queryFn: async () => {
      if (!session?.access_token) return { streak: 0, completed: [] };
      return fetchProgress(session.access_token, topic);
    },
    enabled: Boolean(session?.access_token),
  });

  const doneSet = useMemo(() => {
    const done = new Set<string>();
    for (const row of progressQuery.data?.completed || []) {
      if (row.level === level) done.add(row.storyId);
    }
    return done;
  }, [progressQuery.data?.completed, level]);

  const stories = feedQuery.data?.stories || [];

  const onFinishStory = async (story: RadioStory) => {
    if (session?.access_token) {
      try {
        await postProgress(session.access_token, story.id, level);
        await queryClient.invalidateQueries({ queryKey: ["progress"] });
      } catch (err) {
        Alert.alert("Progress not saved", err instanceof Error ? err.message : "Unknown error");
      }
    }
    setPlayerStory(null);
  };

  const handleSendOtp = async () => {
    const cleanEmail = email.trim();
    if (!cleanEmail) return;
    setSendingOtp(true);
    try {
      await sendOtp(cleanEmail);
      setOtpSent(true);
      Alert.alert("Code sent", "Check your email for the 6-digit code.");
    } catch (err) {
      Alert.alert("Could not send code", err instanceof Error ? err.message : "Unknown error");
    } finally {
      setSendingOtp(false);
    }
  };

  const handleVerifyOtp = async () => {
    const cleanEmail = email.trim();
    const cleanOtp = otp.trim();
    if (!cleanEmail || !cleanOtp) return;
    setSendingOtp(true);
    try {
      await verifyOtp(cleanEmail, cleanOtp);
      setOtp("");
      setOtpSent(false);
      Alert.alert("Signed in", "Your progress now syncs to your account.");
    } catch (err) {
      Alert.alert("Code invalid", err instanceof Error ? err.message : "Unknown error");
    } finally {
      setSendingOtp(false);
    }
  };

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <>
      <ScrollView
        style={{ flex: 1, backgroundColor: "#F8FAFC" }}
        contentContainerStyle={{
          paddingTop: Math.max(insets.top + 8, 24),
          paddingHorizontal: 16,
          paddingBottom: Math.max(insets.bottom + 32, 48),
          gap: 16,
        }}
        refreshControl={<RefreshControl refreshing={feedQuery.isFetching} onRefresh={feedQuery.refetch} />}
      >
        <View
          style={{
            backgroundColor: "#FFFFFF",
            borderRadius: 20,
            borderWidth: 2,
            borderColor: "#292524",
            padding: 14,
            gap: 8,
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <View
              style={{
                width: 32,
                height: 32,
                borderRadius: 999,
                backgroundColor: "#2DD4BF",
                alignItems: "center",
                justifyContent: "center",
                borderWidth: 2,
                borderColor: "#292524",
              }}
            >
              <Radio color="#0F172A" size={18} />
            </View>
            <Text style={{ fontSize: 28, fontWeight: "900", color: "#0F172A" }}>Neoma Radio</Text>
          </View>
          <Text style={{ color: "#334155", fontWeight: "600" }}>
            Production mobile listening with per-word Spanish glosses.
          </Text>
        </View>

        <View
          style={{
            backgroundColor: "#FFFFFF",
            borderRadius: 16,
            padding: 12,
            borderWidth: 2,
            borderColor: "#292524",
            gap: 12,
          }}
        >
          <Text style={{ fontWeight: "900", color: "#0F172A" }}>Topic</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {TOPICS.map((t) => (
              <Pressable
                key={t.key}
                onPress={() => setTopic(t.key)}
                style={{
                  borderRadius: 999,
                  borderWidth: 2,
                  borderColor: topic === t.key ? "#292524" : "#CBD5E1",
                  backgroundColor: topic === t.key ? "#2DD4BF" : "#FFFFFF",
                  paddingHorizontal: 12,
                  paddingVertical: 7,
                }}
              >
                <Text style={{ fontWeight: "800", color: "#0F172A" }}>{t.label}</Text>
              </Pressable>
            ))}
          </View>

          <Text style={{ fontWeight: "900", color: "#0F172A" }}>Difficulty</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {LEVELS.map((L) => (
              <Pressable
                key={L.label}
                onPress={() => setLevelLabel(L.label)}
                style={{
                  borderRadius: 999,
                  borderWidth: 2,
                  borderColor: levelLabel === L.label ? "#292524" : "#CBD5E1",
                  backgroundColor: levelLabel === L.label ? "#FBCFE8" : "#FFFFFF",
                  paddingHorizontal: 12,
                  paddingVertical: 7,
                }}
              >
                <Text style={{ fontWeight: "800", color: "#0F172A" }}>{L.label}</Text>
              </Pressable>
            ))}
          </View>

          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <Text style={{ fontWeight: "700", color: "#0F172A" }}>Auto-play</Text>
            <Switch value={autoPlay} onValueChange={setAutoPlay} />
          </View>
        </View>

        <View
          style={{
            backgroundColor: "#FFFFFF",
            borderRadius: 16,
            padding: 12,
            borderWidth: 2,
            borderColor: "#292524",
            gap: 8,
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <Text style={{ fontSize: 16, fontWeight: "900", color: "#0F172A" }}>
              {TOPICS.find((t) => t.key === topic)?.label || "Stories"}
            </Text>
            <Pressable onPress={() => feedQuery.refetch()} style={{ padding: 6 }}>
              <RefreshCw color="#0F172A" size={18} />
            </Pressable>
          </View>
          <Text style={{ color: "#64748B", fontWeight: "700" }}>
            Streak: {session ? progressQuery.data?.streak ?? 0 : 0} {session ? "" : "(guest mode)"}
          </Text>
          {feedQuery.isLoading ? (
            <ActivityIndicator />
          ) : feedQuery.error ? (
            <Text style={{ color: "#B91C1C", fontWeight: "700" }}>
              {feedQuery.error instanceof Error ? feedQuery.error.message : "Could not load stories."}
            </Text>
          ) : stories.length === 0 ? (
            <Text style={{ color: "#475569" }}>
              No stories available yet. Run ingest from the web admin panel, then refresh here.
            </Text>
          ) : (
            <View style={{ gap: 10 }}>
              {stories.map((story) => (
                <StoryCard
                  key={story.id}
                  story={story}
                  done={doneSet.has(story.id)}
                  onPress={() => setPlayerStory(story)}
                />
              ))}
            </View>
          )}
        </View>

        {isConfigured ? (
          <View
            style={{
              backgroundColor: "#FFFFFF",
              borderRadius: 16,
              padding: 12,
              borderWidth: 2,
              borderColor: "#292524",
              gap: 10,
            }}
          >
            <Text style={{ fontSize: 16, fontWeight: "800", color: "#0F172A" }}>Account</Text>
            {session ? (
              <View style={{ gap: 8 }}>
                <Text style={{ color: "#334155" }}>{session.user.email}</Text>
                <Pressable
                  onPress={() => signOut()}
                  style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: "#FEE2E2", borderRadius: 10, paddingVertical: 10 }}
                >
                  <LogOut size={16} color="#991B1B" />
                  <Text style={{ color: "#991B1B", fontWeight: "800" }}>Sign out</Text>
                </Pressable>
              </View>
            ) : (
              <View style={{ gap: 8 }}>
                <Text style={{ color: "#475569" }}>Sign in with email code to sync streak and completed stories.</Text>
                <TextInput
                  value={email}
                  onChangeText={setEmail}
                  placeholder="you@example.com"
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="email"
                  textContentType="emailAddress"
                  keyboardType="email-address"
                  style={{ borderWidth: 1, borderColor: "#CBD5E1", borderRadius: 10, paddingHorizontal: 10, paddingVertical: 9 }}
                />
                {otpSent ? (
                  <TextInput
                    value={otp}
                    onChangeText={setOtp}
                    placeholder="6-digit code"
                    keyboardType="number-pad"
                    textContentType="oneTimeCode"
                    autoComplete="one-time-code"
                    style={{ borderWidth: 1, borderColor: "#CBD5E1", borderRadius: 10, paddingHorizontal: 10, paddingVertical: 9 }}
                  />
                ) : null}
                <Pressable
                  onPress={otpSent ? handleVerifyOtp : handleSendOtp}
                  disabled={sendingOtp}
                  style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: "#0EA5E9", borderRadius: 10, paddingVertical: 10, opacity: sendingOtp ? 0.7 : 1 }}
                >
                  <LogIn size={16} color="#FFFFFF" />
                  <Text style={{ color: "#FFFFFF", fontWeight: "800" }}>{otpSent ? "Verify code" : "Send code"}</Text>
                </Pressable>
              </View>
            )}
          </View>
        ) : (
          <View style={{ backgroundColor: "#FFF7ED", borderRadius: 16, padding: 12, borderWidth: 1, borderColor: "#FDBA74" }}>
            <Text style={{ color: "#9A3412", fontWeight: "700" }}>
              Supabase env vars are missing, so the app is running in guest-only mode.
            </Text>
          </View>
        )}
      </ScrollView>

      <StoryPlayerModal
        visible={Boolean(playerStory)}
        story={playerStory}
        autoPlay={autoPlay}
        autoPlayDelayMs={autoPlayDelayMs}
        onChangeDelay={setAutoPlayDelayMs}
        onClose={() => setPlayerStory(null)}
        onFinished={async () => {
          if (playerStory) await onFinishStory(playerStory);
        }}
      />
    </>
  );
}
