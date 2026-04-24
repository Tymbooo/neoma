import { Pressable, Text, View } from "react-native";
import { Clock3 } from "lucide-react-native";
import type { RadioStory } from "../lib/types";

type Props = {
  story: RadioStory;
  onPress: () => void;
  done: boolean;
};

export function StoryCard({ story, onPress, done }: Props) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        backgroundColor: "#FFFBEB",
        borderRadius: 16,
        borderColor: "#292524",
        borderWidth: 2,
        padding: 14,
        gap: 8,
      }}
    >
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <Text style={{ flex: 1, fontSize: 16, fontWeight: "800", color: "#0F172A" }}>{story.title}</Text>
        {done ? (
          <Text style={{ fontSize: 11, fontWeight: "700", color: "#15803D" }}>DONE</Text>
        ) : null}
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Clock3 size={14} color="#57534E" />
        <Text style={{ color: "#57534E", fontSize: 12 }}>
          {Math.max(1, Math.round((story.durationSec || story.sentences.length * 6) / 60))} min
        </Text>
      </View>
      <Text style={{ color: "#292524", lineHeight: 20 }}>{story.displayBody}</Text>
    </Pressable>
  );
}
