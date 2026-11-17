# Senior UNO Values

**Conduct Award Rating System · Nasugbu Senior High School 1**
*Shaping Senior UNOs of character*

Every subject teacher of a section rates each student on the four DepEd core values
(Maka-Diyos, Makatao, Makakalikasan, Makabansa) using the official Observed Values marks
(**AO**, **SO**, **RO**, **NO**; DepEd Order No. 8, s. 2015, Table 13). Live averages show who is
leading for the Conduct Award.

Developed by **STEM-12 Newton**: AJ Tindugan (leader), Francis Betita, John Carlo Manalo,
Priam Pescozo, Louie Briones, Niel Jonas Dimafelix, Drew Emmanuel Bautista.
Project adviser: **Eron C. Panaligan**. Principal: **Sofio S. Panaligan Jr.**

---

## How it works

| Who | What they do |
|---|---|
| **Teacher** | Signs up, waits for approval, enters each section's **access code** once per term, rates every student on the 4 core values, and votes in tie-breaks. |
| **Class adviser** | Creates the advisory section, uploads the class list, shares and regenerates the access code, opens and closes voting each term, and starts the tie-break. |
| **Principal / coordinator** | Approves teacher accounts, creates the school year, starts Terms 1–3, and sees every section's progress and leading student. |

### How marks are computed
- Each mark is converted to points: AO = 4, SO = 3, RO = 2, NO = 1.
- **For each core value**, the adviser's mark counts **30%** and the average of the other subject
  teachers counts **70%**. If only one side has rated so far, that side counts fully.
- A student's **term mark** is the average of the 4 core values.
- The **final mark** is the average of the Term 1–3 marks.
- Averages are shown back as official marks: **3.50+ = AO**, **2.50–3.49 = SO**, **1.50–2.49 = RO**, below 1.50 = **NO**.
- **Individual marks are anonymous.** The database only lets a teacher read their *own* marks; everyone
  else (including the principal) sees averages only.
- **Ties:** if two or more students share the top final mark after Term 3 voting closes, the adviser starts a
  tie-break. Every teacher who handled the section in any term picks one student. If that vote is also tied,
  the adviser decides.

### Access codes
- Each section gets a new code every term (format `K7P-4QX`), so teachers re-link at the start of each term.
- **Regenerate** makes the old code stop working immediately. Teachers must enter the new code to keep rating,
  and their saved ratings are kept.

### Class list upload options
1. **Paste** names copied from Excel, Google Sheets or a document, as `Last, First Middle` or as spreadsheet columns.
2. **Upload an Excel or CSV file.** A template can be downloaded from the upload window.
3. **Import School Form 1 (SF1)** from LIS. Every row with a 12-digit LRN is read.
4. **Add students one by one.**

Each option shows a preview before saving, and duplicates are skipped.

### Notifications
- **In-app:** the bell icon. Works with no extra setup.
- **Email and phone push:** optional. See *Step 6* below.

Teachers are notified when:
- voting opens
- a section's access code changes
- a new term starts
- a tie-break begins
- voting closes within 24 hours (optional reminder)
- their account is approved

---

## What's in this folder

```
public/                  ← the website (this is what Netlify publishes)
  index.html             landing page + opening animation
  login.html             log in / sign up / reset password
  app.html               the app for teachers, advisers and the principal
  css/style.css          the liquid-glass design
  js/config.js           ← YOU EDIT THIS: Supabase URL + key
  js/*.js                app code
  tools/vapid.html       makes the keys for phone push notifications
  sw.js, manifest.webmanifest   lets teachers install it like an app
supabase/
  schema.sql             ← the whole database (run once)
  make-me-principal.sql  gives the principal admin access
  optional-deadline-reminders.sql
  functions/notify/index.ts     sends email + push notifications
netlify/functions/keepalive.mjs keeps the free database awake between terms
netlify.toml             Netlify settings
```

---

## Deployment (free: Supabase + Netlify + GitHub)

Allow about 30–45 minutes. You need a Gmail or school email for each account.

### Step 1: Create the database (Supabase)
1. Go to **supabase.com** → *Start your project* → sign in with GitHub.
2. **New project**. Use these settings:
   - Name: `senior-uno-values`
   - Database password: a strong one, saved somewhere safe
   - Region: **Southeast Asia (Singapore)**
3. Wait until the project is ready, then open **SQL Editor → New query**.
4. Open `supabase/schema.sql`, copy **everything**, paste it in and click **Run**. You should see *Success*.
5. **Authentication → Sign In / Providers → Email**: turn **off** "Confirm email" and click **Save**.
   *(Recommended: the principal's approval already verifies teachers, and Supabase's free email sender is limited to a few emails per hour.)*
6. **Project Settings → API**. Copy the **Project URL** and the **anon public** key.

### Step 2: Connect the website to the database
Open `public/js/config.js` and paste the two values:
```js
export const SUPABASE_URL = 'https://abcdefgh.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOi...';
```
The anon key is meant to be public. The database's security rules protect the data.

### Step 3: Put the code on GitHub
1. Create a free account at **github.com**.
2. **New repository** → name `senior-uno-values` → Create.
3. Click **uploading an existing file** and drag in *everything inside this folder*. Keep the folder structure.
4. Click **Commit changes**.

### Step 4: Publish the website (Netlify)
1. Go to **netlify.com** → sign up with GitHub.
2. **Add new project → Import an existing project → GitHub** → choose `senior-uno-values`.
3. Leave the build settings as they are. `netlify.toml` already says to publish the `public` folder.
4. Click **Deploy**.
5. **Project configuration → Change project name** → `senioruno-values`.
   Your site is now **https://senioruno-values.netlify.app** (or a similar free address).
6. **Project configuration → Environment variables**. Add `SUPABASE_URL` and `SUPABASE_ANON_KEY` with the same values as in Step 2.
   This powers the daily keep-alive, then **Deploys → Trigger deploy**.
7. Back in Supabase, open **Authentication → URL Configuration**:
   - **Site URL**: your Netlify address.
   - **Redirect URLs**: add `https://senioruno-values.netlify.app/**`.

From now on, every change committed to GitHub is published automatically.

### Step 5: Make the principal the administrator
1. The principal (or coordinator) opens the website → **Sign up as Teacher** → creates their account.
2. In Supabase **SQL Editor**, open `supabase/make-me-principal.sql`, put the principal's email in it and click **Run**.
3. The principal logs in and opens **School Overview**:
   - **Add school year** (e.g. `2026–2027`) → **Start Term 1**
   - Approve teachers as they sign up.
4. Advisers then open **My Advisory**:
   - Create the section.
   - Upload the class list.
   - Share the access code.
   - **Open voting**.

### Step 6 (optional): Email and phone notifications
**Email (Brevo, free 300 emails/day)**
1. Sign up at **brevo.com**.
2. **Senders & IP → Senders**: add and verify the address emails will come from.
3. **SMTP & API → API Keys**: create a key.

**Push keys**
1. Open `https://YOUR-SITE.netlify.app/tools/vapid.html` and click **Generate keys**.
2. Paste the **public** key into `VAPID_PUBLIC_KEY` in `public/js/config.js` and commit the change.

**The notify function (Supabase)**
1. **Edge Functions → Deploy a new function → Via Editor**. Name it `notify`, paste the contents of
   `supabase/functions/notify/index.ts`, and click **Deploy**.
2. Open the function's settings and turn **off** "Enforce JWT verification". The function checks its own secret instead.
3. **Edge Functions → Secrets**. Add these:

   | Name | Value |
   |---|---|
   | `WEBHOOK_SECRET` | any long random text |
   | `SITE_URL` | `https://senioruno-values.netlify.app` |
   | `BREVO_API_KEY` | your Brevo key |
   | `MAIL_FROM_EMAIL` | the verified sender address |
   | `MAIL_FROM_NAME` | `Senior UNO Values` |
   | `VAPID_PUBLIC_KEY` | the public key |
   | `VAPID_PRIVATE_KEY` | the private key |
   | `VAPID_SUBJECT` | `mailto:` + your email |

4. **Database → Webhooks → Create a new hook**. Use these settings:
   - Table: `notifications`
   - Events: **Insert**
   - Type: **Supabase Edge Functions** → `notify` (method POST)
   - HTTP header: `x-webhook-secret` = the same `WEBHOOK_SECRET`
5. Optional: deadline reminders.
   1. **Database → Extensions**: enable `pg_cron`.
   2. Run `supabase/optional-deadline-reminders.sql`.

On iPhone, teachers must first add the site to the Home Screen (Safari → Share → *Add to Home Screen*),
then turn on notifications in **Settings** inside the app. On Android, Chrome works directly.

---

## Good to know
- **Free plan pausing:** Supabase pauses free projects after about 7 days with no activity.
  The included Netlify keep-alive (Step 4.6) pings the database daily to prevent this.
  If the project ever pauses, open the Supabase dashboard and click **Resume project**. The data is kept.
- **Backups:** the free plan has no automatic backups. At the end of each term, the adviser can **Export CSV** of the standings,
  or you can use Supabase **Database → Backups** on a paid plan.
- **Changing marks:** teachers can change marks any time while voting is open. Closing voting locks them,
  and **Reopen voting** unlocks them.
- **Removing a student** also removes that student's ratings.
- **Data privacy:** only approved staff accounts can see student names. Keep access codes inside the faculty.

## Troubleshooting
| Problem | Fix |
|---|---|
| "This website is not connected to its database yet" | Fill in `public/js/config.js` (Step 2) and redeploy. |
| Teachers stuck on "Waiting for approval" | The principal approves them in **School Overview**. They then tap **Check again**. |
| "That code is not valid for this term" | The adviser regenerated the code, or a new term started. Ask the adviser for the current code. |
| Adviser sees no access code | The principal hasn't started a term yet (School Overview → Start Term 1). |
| No emails arrive | Check the Edge Function secrets, the webhook header, and the Brevo sender verification. Also check the spam folder. |
| Password reset link goes to the wrong site | Set the Site URL and Redirect URLs in Supabase (Step 4.7). |
