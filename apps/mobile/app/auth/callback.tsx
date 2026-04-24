import { useEffect } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { router } from "expo-router";
import { useAuth } from "../../src/providers/AuthProvider";

export default function AuthCallbackScreen() {
  const { session, loading } = useAuth();

  useEffect(() => {
    if (!loading && session) {
      router.replace("/");
      return;
    }
    // Safety timeout so the user never gets stuck here.
    const id = setTimeout(() => {
      router.replace("/");
    }, 4000);
    return () => clearTimeout(id);
  }, [session, loading]);

  return (
    <View
      style={{
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "#F8FAFC",
        paddingHorizontal: 24,
        gap: 12,
      }}
    >
      <ActivityIndicator />
      <Text style={{ fontSize: 18, fontWeight: "800", color: "#0F172A", textAlign: "center" }}>
        Signing you in...
      </Text>
      <Text style={{ color: "#475569", textAlign: "center" }}>
        If this screen stays open, go back to the home screen and your session should appear automatically.
      </Text>
    </View>
  );
}
