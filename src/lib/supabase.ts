import { createClient, SupabaseClient } from "@supabase/supabase-js";

// Debug environment variables
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (process.env.NODE_ENV === "development") {
  console.log("Supabase Debug:", {
    supabaseUrl: supabaseUrl ? "SET" : "MISSING",
    supabaseAnonKey: supabaseAnonKey ? "SET" : "MISSING",
    nodeEnv: process.env.NODE_ENV,
  });
}

if (!supabaseUrl || !supabaseAnonKey) {
  console.error("Missing Supabase environment variables");
  console.log("Please check your .env.local file contains:");
  console.log("NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co");
  console.log("NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key");
  throw new Error(
    "Missing Supabase environment variables. Please check your .env.local file.",
  );
}

// Singleton pattern to prevent multiple client instances
let supabaseInstance: SupabaseClient | null = null;
let supabaseAdminInstance: SupabaseClient | null = null;

export const supabase = (() => {
  if (!supabaseInstance) {
    supabaseInstance = createClient(supabaseUrl, supabaseAnonKey);
  }
  return supabaseInstance;
})();

export const supabaseAdmin = (() => {
  if (!supabaseAdminInstance) {
    supabaseAdminInstance = createClient(
      supabaseUrl,
      process.env.SUPABASE_SERVICE_ROLE_KEY || supabaseAnonKey,
      {
        auth: {
          persistSession: false,
        },
      },
    );
  }
  return supabaseAdminInstance;
})();
