# Site Revamp — AI Redesign Test

A test page where a visitor enters any website URL and gets **three AI-generated
redesigns** of it — modern and minimal — shown side by side. The visitor picks a
favorite, and that design's full HTML code is **emailed to the site owner**.

## Pieces

| Piece | Where it lives | Job |
|---|---|---|
| Front-end | `index.html` in this repo, served by GitHub Pages | URL form, sample previews, pick-one button |
| Backend | `worker/worker.js`, deployed as a Cloudflare Worker | Fetches the entered site, calls the AI 3 times, emails the chosen code |
| AI | Anthropic (Claude), OpenAI, or Google Gemini — chosen by config | Writes each redesign as one self-contained HTML file |
| Email | Resend | Sends the chosen HTML as an attachment |

GitHub Pages alone can't do this job: it serves static files only, can't hold
secret API keys, and can't send email. That's why the small worker exists.
No keys are stored in this repo — they live only as Worker secrets.

## One-time setup

1. **GitHub Pages** — Repo Settings → Pages → Deploy from branch `main`, folder `/ (root)`.
   The site appears at `https://<username>.github.io/website-revamp-test/`.
2. **Cloudflare Worker** — Create a free Cloudflare account, create a Worker,
   paste in `worker/worker.js`, deploy. Note its `*.workers.dev` URL.
3. **Point the page at the worker** — In `index.html`, set `BACKEND_URL` to the
   worker URL and commit.
4. **Worker secrets** (Cloudflare dashboard → Worker → Settings → Variables, or `wrangler secret put`):
   - `AI_PROVIDER` = `anthropic`, `openai` or `gemini`
   - `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` or `GEMINI_API_KEY` (matching the provider;
     Gemini keys are free in Google AI Studio and the free tier is plenty for testing)
   - `RESEND_API_KEY` (free at resend.com)
   - `TO_EMAIL` = the address that should receive chosen designs
   - `ALLOWED_ORIGIN` = the GitHub Pages origin, e.g. `https://<username>.github.io`
5. **Email note** — Until a domain is verified in Resend, mail is sent from
   `onboarding@resend.dev` and (in Resend's test mode) can only go to the
   address the Resend account was signed up with. Verify a domain in Resend
   to send from your own address to anyone.

## The three design directions

1. **Clean Light** — airy, white, one accent color
2. **Bold Dark** — dark, high contrast, big headlines
3. **Soft Neutral** — warm neutrals, soft shadows, rounded corners

Edit `STYLE_BRIEFS` in `worker/worker.js` to change them.
