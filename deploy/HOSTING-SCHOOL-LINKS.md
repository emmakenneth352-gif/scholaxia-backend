# School links that work automatically — cPanel untouched (Cloudflare)

Goal: after a school is approved, its link `https://<slug>.scholaxia.com/`
works by itself. The main site on cPanel/Hostinger stays exactly as it is.

How it works:
- Cloudflare (free plan) manages DNS for scholaxia.com.
- The apex `@` and `www` records keep pointing at cPanel exactly as today
  (DNS-only, gray cloud) — main site unaffected.
- A wildcard `*` record (orange cloud) + a tiny Cloudflare Worker route
  send every school subdomain to the Render backend, which already serves
  the branded student app at `/school/<slug>/`.

Per-school steps after this one-time setup: **none.** Approve the school
and its link is live.

## Optional school-owned domain

Every registered school keeps its generated `<slug>.scholaxia.com` link.
If a school later requests its own domain, add that hostname in the main
Scholaxia admin's school editor after the domain has been hosted. Point the
domain's DNS to the Render service and add it under that service's custom
domains so HTTPS is provisioned. The backend matches the configured hostname
to the same school record, so both links open and manage the same portal.
Use the school's Scholaxia subdomain if its custom-domain DNS or TLS is not
ready yet.

---

## One-time setup (~15 minutes)

### 1. Add the domain to Cloudflare (free)
1. Sign up / log in at dash.cloudflare.com → **Add a site** → `scholaxia.com` → Free plan.
2. Cloudflare scans your existing records. It should show:
   - `A · @ · 163.61.188.7` and `A · www · 163.61.188.7` (your cPanel site)
   - `A · surelix · 163.61.188.7`
   - any MX records (leave everything as imported).
3. Make sure `@`, `www`, `surelix`, and all mail records are **DNS only**
   (gray cloud) — only the new `*` record will be proxied (orange).
4. Hostinger → Domains → scholaxia.com → **Nameservers** → change to
   Cloudflare's two nameservers (Cloudflare shows them at the end of
   onboarding). DNS records themselves don't change — the site keeps
   working immediately.

### 2. Add the wildcard record
In Cloudflare → DNS → Add record:
- Type: `CNAME` · Name: `*` · Target: `scholaxia1.onrender.com`
- **Proxy status: Proxied (orange cloud)** ← required for the Worker route
- TTL: Auto

(If you already added `*` in Hostinger, delete it there — Cloudflare now
serves the zone. Keep Hostinger's `@`, `www`, `surelix`, MX records so the
import matches.)

### 3. Create the Worker
1. Cloudflare Dashboard → **Workers & Pages → Create → Worker** → name it
   `school-links` → Deploy.
2. Edit code → paste `deploy/cloudflare-school-worker.js` → Deploy.
3. Worker → **Settings → Domains & Routes → Add → Route**:
   - Zone: `scholaxia.com`
   - Route: `*.scholaxia.com/*`
4. Done. `https://divine-light.scholaxia.com/` now serves the
   Divine-Light-branded student login, and so will every future school.

## Notes
- TLS for school subdomains comes from Cloudflare's free Universal SSL
  wildcard — no per-school certificates to manage.
- Keep Hostinger as the registrar; only nameservers move.
- The `/school/<slug>/` links on Render keep working as a fallback.
- If a slug doesn't exist or isn't approved, the backend returns the
  friendly "School not found" page (already built).
- Free plan limits are far above what school traffic needs; if the site
  grows, Workers paid tier is $5/mo.
