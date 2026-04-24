import { useMemo } from "react";
import { Pressable, Text, View } from "react-native";
import { lineTokens } from "../lib/tokenize";

type Props = {
  sentence: string;
  glosses?: string[] | null;
  showGlosses: boolean;
  onToggleGlosses: () => void;
};

export function WordGlossLine({ sentence, glosses, showGlosses, onToggleGlosses }: Props) {
  const tokens = useMemo(() => lineTokens(sentence), [sentence]);

  return (
    <Pressable onPress={onToggleGlosses} style={{ gap: 8 }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", columnGap: 8, rowGap: 8 }}>
        {tokens.map((tok, idx) => (
          <View key={`${tok}-${idx}`} style={{ alignItems: "center", minWidth: 12 }}>
            {showGlosses ? (
              <Text style={{ fontSize: 11, color: "#9A3412", textAlign: "center", maxWidth: 110 }}>
                {glosses?.[idx] || ""}
              </Text>
            ) : (
              <Text style={{ fontSize: 11, color: "#FDBA74", textAlign: "center" }}> </Text>
            )}
            <Text style={{ fontSize: 16, fontWeight: "700", color: "#111827" }}>{tok}</Text>
          </View>
        ))}
      </View>
    </Pressable>
  );
}
