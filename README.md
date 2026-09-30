# Bedfordshire Squash — county website

The new home of squash and Squash 57 (racketball) in Bedfordshire, replacing the out-of-date
[beds-sra.co.uk](http://www.beds-sra.co.uk/) Weebly site.

**Live site:** https://philj50.github.io/beds-squash/ (until a custom domain is set up — see below)
**Content editor:** https://philj50.github.io/beds-squash/admin/

---

## What's here

| Feature | Where |
| --- | --- |
| News posts with categories, featured posts, RSS feed | `/news/`, `/rss.xml` |
| Events calendar — county, club, Inter-County and **England Squash** dates, with an iCal feed to subscribe to | `/events/`, `/events.ics` |
| Interactive **map of clubs & courts** (Leaflet + OpenStreetMap, no API key) with club pages | `/clubs/` |
| Leagues page, **online tables & fixtures**, SquashLevels levels | `/leagues/`, `/leagues/results/`, `/leagues/ratings/` |
| Tournaments + **Honours board** (County Closed champions by year) | `/tournaments/` |
| Juniors, County Teams and About pages (editable text) | `/juniors/`, `/county-teams/`, `/about/` |
| **Photo galleries** with lightbox | `/gallery/` |
| **Meeting minutes** and policy documents (PDF uploads) | `/documents/` |
| Committee list and contact page | `/about/`, `/contact/` |
| Browser-based CMS so committee members can edit without touching code | `/admin/` |

Tech: [Astro 7](https://astro.build) static site · Markdown content collections · [Decap CMS](https://decapcms.org) · Leaflet ·
[Supabase](https://supabase.com) for league data, captain tools and SquashLevels sync · GitHub Actions → GitHub Pages.

---

## The build plan

**Phase 1 — Foundation (done in this repo)**
1. Research: audited the old Beds SRA site and county sites for Herts, Surrey, Kent and Yorkshire to define the information architecture.
2. Brand: new "Beds Squash" crest in Bedfordshire county colours (black / gold / red), favicons, social image.
3. Content model: news, events, clubs (with geolocation), minutes, documents, galleries, honours, committee, pages.
4. Seed content: all 8 league clubs (addresses + coordinates from League Master), pay-and-play venues, officials, policy document slots, 2026 County Closed results.
5. Site: responsive dark theme, home page, all sections above, RSS + iCal feeds, sitemap, SEO/OpenGraph.
6. CMS: Decap config for every collection, editorial workflow (draft → review → publish).
7. Deploy: GitHub Actions workflow to GitHub Pages.

**Phase 2 — Go live (needs the committee)**
1. Upload the real PDFs (minutes, constitution, safeguarding, codes of conduct) via the CMS — see *Migrating the old content*.
2. Confirm club details flagged in the content (David Lloyd venue, Flitwick courts, contact emails).
3. Enable CMS login (10-minute OAuth setup, below) and invite editors as GitHub collaborators.
4. Register a domain (`bedfordshiresquash.co.uk`, `bedssquash.co.uk`, `bedssquash.org.uk` were all available on 26 Sep 2026) and point it at GitHub Pages.
5. Ask the owner of beds-sra.co.uk to add a "we've moved" banner/link, update the England Squash county page and the Facebook group with the new address.

**Section 2 — club captains (live, noindex)**
- `/captains/` — squad list (sign-in; self-registration paused).
- `/captains/matches/` — fixtures, availability and team order (League Master sync).
- `/captains/admin/` — county admin: clubs, roles, traffic stats, match articles.
- `/juniors/closed/entries/` — junior closed organiser list.

Public pages also include read-only **league tables** (`/leagues/results/`) and **SquashLevels** (`/leagues/ratings/`).

**Later, still public**
- Pull England Squash news/events automatically (their site blocks scraping; would need an official feed or a manual monthly sweep).
- Junior ladder / results tables as a content collection.
- Club box-league links and "find a partner" board.
- Newsletter signup (e.g. Buttondown / Mailchimp embed).
- Search (Pagefind works with Astro static output).

---

## Editing the site (committee guide)

### Option A — the CMS (recommended)
1. Go to `/admin/` and log in with GitHub.
2. Pick a collection (News, Events, Clubs, Minutes…), click **New**, fill in the form, **Save**.
3. With editorial workflow on, the entry sits in *Drafts* → *In review* → *Ready*; click **Publish** to go live.
   The site rebuilds automatically in ~1–2 minutes.

**Adding an England Squash date:** Events → New → set *Source* = "England Squash", paste the link to the event
page on englandsquash.com, publish. It shows on `/events/` with a red England Squash badge and in the `.ics` feed.

**Adding photos:** Photo galleries → New → title, date, then add photos in the *Photos* list. Or attach an image to a news post.

**Adding a club or venue:** Clubs & venues → New → enter the postcode. If you leave latitude/longitude blank, the
build looks up the postcode (postcodes.io) and places the map marker automatically.

**Minutes:** Meeting minutes → New → date, type (AGM/Committee), upload the PDF. You can also paste the minutes as text.

### Option B — edit on GitHub
All content is plain Markdown in `src/content/<collection>/*.md` with a YAML header. Uploaded files live in
`public/uploads/`. Edit or add a file on GitHub and commit to `main`; the site rebuilds.

### Option C — locally
```bash
npm install
npm run dev            # http://localhost:4321/beds-squash/
npm run cms:proxy      # in a second terminal — lets /admin/ work locally with no login
npm run build          # production build to dist/
npm run check          # type-check
```

---

## Enable the CMS login (one-off, ~10 minutes)

Decap's GitHub backend needs a tiny OAuth relay because GitHub Pages can't keep a secret.
The simplest free option is a Cloudflare Worker:

1. Deploy [sveltia-cms-auth](https://github.com/sveltia/sveltia-cms-auth) (works with Decap CMS too) to Cloudflare Workers — "Deploy to Cloudflare" button in its README.
2. On GitHub: **Settings → Developer settings → OAuth Apps → New**. Homepage = the site URL; callback = `https://<worker>.workers.dev/callback`.
3. Put the OAuth client ID/secret into the worker's environment variables (as the README describes) and set `ALLOWED_DOMAINS` to the site's hostname.
4. In `public/admin/config.yml`, uncomment `base_url` (the worker URL) and `auth_endpoint: /auth`, and set `local_backend: false`.
5. Add each editor as a repo **collaborator** (Settings → Collaborators) — that is what controls who can log in.

Alternative: host on Netlify instead of GitHub Pages and use its built-in GitHub OAuth provider (Site settings → Access & security → OAuth).

---

## Custom domain

1. Buy the domain (Nominet registrars: e.g. Cloudflare Registrar, 123-reg, Namecheap).
2. GitHub repo → **Settings → Pages → Custom domain** → enter it, tick *Enforce HTTPS*. GitHub tells you the DNS records
   (a `CNAME` for `www` → `philj50.github.io`, and `A`/`AAAA` records for the apex).
3. Repo → **Settings → Secrets and variables → Actions → Variables**: add `SITE_URL = https://bedfordshiresquash.co.uk` and `SITE_BASE = /`.
4. Update `site_url`, `display_url` and `logo_url` in `public/admin/config.yml`, and the OAuth app / worker `ALLOWED_DOMAINS`.
5. Push any commit to rebuild.

---

## Migrating the old content

The old site (last updated Sept 2023) had these sections; where they live now:

| Old page | New home |
| --- | --- |
| Fixtures / Results / Clubs | `/clubs/`, `/leagues/` (League Master links) |
| County Squash Seniors, County Weekends, O35/O45 | `/county-teams/` + reports as News |
| County Squash Juniors, Ladder, Handbook, Squad Programme | `/juniors/` + PDFs under Documents |
| League Rules, PAR 15, Conduct Rules | Documents → *Bedfordshire League Rules* |
| Tournaments: Beds Closed 2015–2023, League Cup, Over 50s Cup | `/tournaments/` honours board (add each year) |
| Photos | `/gallery/` |
| Beds SRA Meeting Minutes (AGMs 2017, 2019, 2020) | `/documents/` — upload the PDFs to the existing entries |
| Policy Documents & Codes of Conduct | `/documents/` — entries exist, upload the PDFs |
| Officials | `/about/`, `/contact/` |
| Web Site Links | Footer |

Download the PDFs from the old Weebly site while it is still up and attach them through the CMS.

---

## Site operations (automation & QA)

### GitHub Actions secrets (repository → Settings → Secrets and variables → Actions)

| Secret | Used by |
| --- | --- |
| `SQUASHLEVELS_EMAIL` | Daily SquashLevels sync |
| `SQUASHLEVELS_PASSWORD` | Daily SquashLevels sync |
| `SUPABASE_URL` | League import & SquashLevels sync |
| `SUPABASE_SERVICE_ROLE_KEY` | League import & SquashLevels sync — use the **Secret key** named `default` (`sb_secret_…`) from Supabase **Settings → API Keys** (not the publishable key) |
| `NVIDIA_API_KEY` | Optional — [NVIDIA NIM](https://build.nvidia.com) API key for richer match articles (template fallback if unset or on error) |
| `NTFY_TOPIC` | Optional — [ntfy](https://ntfy.sh) topic name for daily OK/fail push (see below) |
| `NTFY_TOKEN` | Optional — only if your ntfy topic is private (Bearer token) |

### Daily push notification (ntfy)

1. Install the **ntfy** app on your phone ([ntfy.sh](https://ntfy.sh)) or use the web UI.
2. Pick a **private, unguessable topic** (e.g. `beds-squash-yourname-a1b2c3`) and subscribe to it in the app.
3. GitHub → **Settings → Secrets → Actions** → add `NTFY_TOPIC` with that exact topic name (not the full URL).
4. Optional: self-hosted server → add repository **Variable** `NTFY_SERVER` (e.g. `https://ntfy.example.com`). Optional private topic → secret `NTFY_TOKEN`.

You get one notification after **League Master** (~06:00 UTC) and one after **SquashLevels** (~07:30 UTC). Failures use high priority. If `NTFY_TOPIC` is unset, workflows skip notify silently.

Workflows: **Deploy to GitHub Pages** (build + post-deploy smoke tests), **Site tests** (`npm run check` + Playwright), **SquashLevels daily**, **Sync League Master**.

### Local commands

```bash
npm test              # Playwright against local preview
npm run test:smoke    # PLAYWRIGHT_BASE_URL=https://philj50.github.io/beds-squash npm run test:smoke
node scripts/squashlevels-daily.mjs --date 2026-08-11
node scripts/backfill-squashlevels-articles.mjs --from 2026-08-01 --to 2026-08-31
```

Match articles use a factual template by default. If `NVIDIA_API_KEY` is set (local `.env` or GitHub secret), the daily job asks NVIDIA NIM to rephrase using the same facts; on failure it falls back to the template. Toggle auto vs manual publish in **captains admin → Match articles**.

Optional repo **Variable** `NVIDIA_MODEL` (default `meta/llama-3.3-70b-instruct`). The HorseRacing project `.env` does not define NVIDIA keys; create a key at [build.nvidia.com](https://build.nvidia.com).

### Theme

Navy is the default. Charcoal: `PUBLIC_SITE_THEME=default npm run build`. Light: `PUBLIC_SITE_THEME=light`.

### Custom domain

Set Actions variables `SITE_URL` and `SITE_BASE=/` (see **Custom domain** above). Deploy already sets `PUBLIC_SITE_THEME=navy`.

### Content still worth adding via CMS

- PDFs on existing document entries (minutes, policies).
- Photo galleries (albums under `/gallery/` — see `src/content/galleries/`).
- Extra honours years on `/tournaments/` as results come in.

---

## Project layout

```
src/
  content.config.ts      # collection schemas (Zod) — the source of truth for content fields
  content/               # Markdown content, one folder per collection
  pages/                 # routes (Astro)
  components/            # Header, Footer, ClubMap (Leaflet), cards…
  layouts/Base.astro     # <head>, fonts, header/footer
  lib/                   # site config, date helpers, geocoding, content queries
  styles/global.css      # design tokens & base styles
public/
  admin/                 # Decap CMS (index.html + config.yml)
  brand/                 # logo variants, OG image
  uploads/               # CMS-managed PDFs and photos
.github/workflows/deploy.yml
```
