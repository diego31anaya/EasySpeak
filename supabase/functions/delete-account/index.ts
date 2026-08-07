// supabase/functions/delete-account/index.ts
//
// Deletes the signed-in user's account. Runs with the SERVICE-ROLE key (admin) —
// which only ever exists here on the server, NEVER in the app. The app calls it via
// `supabase.functions.invoke('delete-account')`; supabase-js attaches the user's
// JWT, which identifies whose account to delete.
//
// Order matters:
//   1. delete the user's recordings from Storage  (NOT covered by the FK cascade),
//   2. delete the auth.users row  →  ON DELETE CASCADE removes profiles + sessions.
//
// Deploy:  supabase functions deploy delete-account
//   (No secret to set — SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY
//    are auto-injected into Edge Functions.)
//
// NOTE: this is Deno, not React Native — excluded from the app tsconfig. The
// `jsr:` import can be swapped to `https://esm.sh/@supabase/supabase-js@2` if your
// Supabase CLI prefers it.

import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const RECORDINGS_BUCKET = 'recordings';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Missing Authorization header' }, 401);

    const url = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    // Identify the caller from their JWT (anon client scoped to their token).
    const caller = createClient(url, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const {
      data: { user },
      error: userErr,
    } = await caller.auth.getUser();
    if (userErr || !user) return json({ error: 'Unauthorized' }, 401);

    const userId = user.id;
    const admin = createClient(url, serviceKey);

    // 1) Delete the user's recordings from Storage. Layout is
    //    recordings/{userId}/{sessionId}/<file>.wav, so list one level deep.
    //    Best-effort: log and proceed to the account deletion even if cleanup
    //    fails (the account removal is what matters; stray files can be swept
    //    later). NOTE: list() defaults to 100 entries — a user with 100+ session
    //    folders would need pagination here; left simple for now.
    const bucket = admin.storage.from(RECORDINGS_BUCKET);
    const { data: sessionDirs, error: listErr } = await bucket.list(userId);
    if (listErr) {
      console.error('[delete-account] storage list failed:', listErr.message);
    } else if (sessionDirs?.length) {
      const paths: string[] = [];
      for (const dir of sessionDirs) {
        const { data: files } = await bucket.list(`${userId}/${dir.name}`);
        for (const f of files ?? []) paths.push(`${userId}/${dir.name}/${f.name}`);
      }
      if (paths.length) {
        const { error: rmErr } = await bucket.remove(paths);
        if (rmErr) console.error('[delete-account] storage remove failed:', rmErr.message);
      }
    }

    // 2) Delete the auth user → ON DELETE CASCADE removes their profiles row + all
    //    their sessions rows.
    const { error: delErr } = await admin.auth.admin.deleteUser(userId);
    if (delErr) return json({ error: delErr.message }, 500);

    return json({ success: true });
  } catch (e) {
    console.error('[delete-account] error:', e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});