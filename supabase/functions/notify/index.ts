// Supabase Edge Function: "notify"
// Runs every time a row is added to the notifications table (via a Database
// Webhook). Sends the same message by email (Brevo) and as a phone/browser
// push notification. In-app notifications already work without this.
//
// Secrets to set (Edge Functions → Secrets):
//   WEBHOOK_SECRET      any long random text; also put it in the webhook header
//   SITE_URL            e.g. https://senioruno-values.netlify.app
//   BREVO_API_KEY       from brevo.com → SMTP & API → API keys (optional)
//   MAIL_FROM_EMAIL     the sender address you verified in Brevo
//   MAIL_FROM_NAME      e.g. Senior UNO Values
//   VAPID_PUBLIC_KEY    from tools/vapid.html (optional, for push)
//   VAPID_PRIVATE_KEY   from tools/vapid.html
//   VAPID_SUBJECT       mailto:your-email@example.com
import webpush from 'npm:web-push@3.6.7';
import { createClient } from 'npm:@supabase/supabase-js@2';

const env = (k: string) => Deno.env.get(k) ?? '';

function escapeHtml(s: string) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

function emailHtml(name: string, title: string, body: string, link: string) {
  return `<!doctype html><html><body style="margin:0;background:#06110A;font-family:Arial,Helvetica,sans-serif;color:#EAF3EC">
  <div style="max-width:560px;margin:0 auto;padding:32px 20px">
    <p style="font-size:13px;letter-spacing:2px;color:#9BE04A;font-weight:bold;margin:0 0 8px">SENIOR UNO VALUES</p>
    <div style="background:#10251A;border:1px solid #2A4634;border-radius:20px;padding:24px">
      <p style="margin:0 0 6px;color:#A9C2B0">Hi ${escapeHtml(name)},</p>
      <h1 style="margin:0 0 10px;font-size:22px;color:#FFFFFF">${escapeHtml(title)}</h1>
      <p style="margin:0 0 20px;line-height:1.5;color:#CFE0D3">${escapeHtml(body)}</p>
      ${link ? `<a href="${escapeHtml(link)}" style="display:inline-block;background:#F2C230;color:#06110A;text-decoration:none;font-weight:bold;padding:12px 22px;border-radius:999px">Open Senior UNO Values</a>` : ''}
    </div>
    <p style="font-size:12px;color:#8FA897;margin-top:16px">Nasugbu Senior High School 1 · Conduct Award Rating System.<br>
    You can turn off email notifications in Settings.</p>
  </div></body></html>`;
}

Deno.serve(async (req) => {
  if (!env('WEBHOOK_SECRET') || req.headers.get('x-webhook-secret') !== env('WEBHOOK_SECRET')) {
    return new Response('Forbidden', { status: 403 });
  }
  const payload = await req.json().catch(() => ({}));
  const n = payload?.record;
  if (!n?.user_id) return new Response('No record', { status: 200 });

  const admin = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'));
  const { data: prof } = await admin.from('profiles').select('email, full_name, email_notifications').eq('id', n.user_id).single();
  const site = env('SITE_URL').replace(/\/$/, '');
  const link = site ? `${site}/app.html${n.link ?? ''}` : '';
  const result: Record<string, unknown> = {};

  // ---- Email (Brevo) ----
  if (prof?.email && prof.email_notifications && env('BREVO_API_KEY') && env('MAIL_FROM_EMAIL')) {
    try {
      const r = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: { 'api-key': env('BREVO_API_KEY'), 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({
          sender: { email: env('MAIL_FROM_EMAIL'), name: env('MAIL_FROM_NAME') || 'Senior UNO Values' },
          to: [{ email: prof.email, name: prof.full_name }],
          subject: `${n.title} · Senior UNO Values`,
          htmlContent: emailHtml(prof.full_name, n.title, n.body ?? '', link),
        }),
      });
      result.email = r.status;
    } catch (e) { result.email = String(e); }
  }

  // ---- Push ----
  if (env('VAPID_PUBLIC_KEY') && env('VAPID_PRIVATE_KEY')) {
    webpush.setVapidDetails(env('VAPID_SUBJECT') || 'mailto:admin@example.com', env('VAPID_PUBLIC_KEY'), env('VAPID_PRIVATE_KEY'));
    const { data: subs } = await admin.from('push_subscriptions').select('*').eq('user_id', n.user_id);
    let sent = 0;
    for (const s of subs ?? []) {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          JSON.stringify({ title: n.title, body: n.body ?? '', link: n.link ?? '' }));
        sent++;
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) await admin.from('push_subscriptions').delete().eq('id', s.id);
      }
    }
    result.push = sent;
  }

  return new Response(JSON.stringify(result), { headers: { 'content-type': 'application/json' } });
});
