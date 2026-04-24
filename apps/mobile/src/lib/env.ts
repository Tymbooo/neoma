const trim = (value: string | undefined) => (value || "").trim();

export const env = {
  apiBaseUrl: trim(process.env.EXPO_PUBLIC_NEOMA_API_BASE_URL),
  supabaseUrl: trim(process.env.EXPO_PUBLIC_SUPABASE_URL),
  supabaseAnonKey: trim(process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY),
};

export const hasSupabaseEnv = Boolean(env.supabaseUrl && env.supabaseAnonKey);
