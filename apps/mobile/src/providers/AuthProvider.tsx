import { createContext, PropsWithChildren, useContext, useEffect, useMemo, useState } from "react";
import * as Linking from "expo-linking";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";

type AuthContextValue = {
  session: Session | null;
  loading: boolean;
  sendOtp: (email: string) => Promise<void>;
  verifyOtp: (email: string, token: string) => Promise<void>;
  signOut: () => Promise<void>;
  isConfigured: boolean;
};

const AuthContext = createContext<AuthContextValue | null>(null);

async function hydrateSessionFromUrl(url: string) {
  if (!supabase || !url) return;
  const parsed = Linking.parse(url);
  const qp = parsed.queryParams || {};

  const accessToken = typeof qp.access_token === "string" ? qp.access_token : "";
  const refreshToken = typeof qp.refresh_token === "string" ? qp.refresh_token : "";
  if (accessToken && refreshToken) {
    await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
    return;
  }

  const tokenHash = typeof qp.token_hash === "string" ? qp.token_hash : "";
  const type = typeof qp.type === "string" ? qp.type : "";
  if (tokenHash && type) {
    const otpType = type as "email" | "recovery" | "invite" | "email_change";
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: otpType });
    if (error) throw error;
  }
}

export function AuthProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }
    let isMounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (isMounted) {
        setSession(data.session ?? null);
        setLoading(false);
      }
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setLoading(false);
    });

    Linking.getInitialURL().then((url) => {
      if (!url) return;
      hydrateSessionFromUrl(url).catch(() => undefined);
    });
    const linkSub = Linking.addEventListener("url", ({ url }) => {
      hydrateSessionFromUrl(url).catch(() => undefined);
    });

    return () => {
      isMounted = false;
      sub.subscription.unsubscribe();
      linkSub.remove();
    };
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      loading,
      isConfigured: Boolean(supabase),
      sendOtp: async (email: string) => {
        if (!supabase) throw new Error("Supabase env missing.");
        const { error } = await supabase.auth.signInWithOtp({
          email,
          options: {
            emailRedirectTo: Linking.createURL("/auth/callback"),
          },
        });
        if (error) throw error;
      },
      verifyOtp: async (email: string, token: string) => {
        if (!supabase) throw new Error("Supabase env missing.");
        const { error } = await supabase.auth.verifyOtp({
          email,
          token,
          type: "email",
        });
        if (error) throw error;
      },
      signOut: async () => {
        if (!supabase) return;
        const { error } = await supabase.auth.signOut();
        if (error) throw error;
      },
    }),
    [loading, session]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used inside AuthProvider");
  }
  return ctx;
}
