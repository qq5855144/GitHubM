import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://backend.appmiaoda.com/projects/supabase311500128454225920';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJhdWQiOiJhdXRoZW50aWNhdGVkIiwiZXhwIjoyMDkzNjk0NjE4LCJpc3MiOiJzdXBhYmFzZSIsInJvbGUiOiJhbm9uIiwic3ViIjoiYW5vbiJ9.TCCMRRmNXi3Cp9ebFdfQbK9__bSDa9czf5hIvRaMYGE';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
            