// Runs once a day on Netlify and makes one small database request so the free
// Supabase project is not paused between terms (free projects pause after
// about 7 days without activity).
// Netlify → Site configuration → Environment variables:
//   SUPABASE_URL, SUPABASE_ANON_KEY  (same values as in public/js/config.js)
export default async () => {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  if (!url || !key) return new Response('Missing SUPABASE_URL / SUPABASE_ANON_KEY', { status: 200 });
  const r = await fetch(`${url}/rest/v1/rpc/public_info`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: '{}',
  });
  return new Response(`ping ${r.status}`);
};

export const config = { schedule: '@daily' };
