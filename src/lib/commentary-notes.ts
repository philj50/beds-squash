import type { SupabaseClient } from '@supabase/supabase-js';

/** Used when the notes table cannot be read. The live switch is ntfy_rules.ntfy-commentary. */
export const COMMENTARY_NOTES = true;

/** Whether a match going on Match commentary should post to beds_commentary_1234. */
export async function commentaryNotesOn(supabase: SupabaseClient): Promise<boolean> {
  const { data, error } = await supabase.from('ntfy_rules').select('enabled').eq('slug', 'ntfy-commentary').maybeSingle();
  if (error || !data) return COMMENTARY_NOTES;
  return data.enabled === true;
}
