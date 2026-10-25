// website-revamp-test — backend (Cloudflare Worker)
//
// Endpoints:
//   POST /generate  { url, mirrorUrl? }            -> { samples: [{label, description, html} x3] }
//   POST /choose    { sourceUrl, label, html, name, email, mirrorUrl? } -> emails the chosen HTML to TO_EMAIL, naming the visitor
//
// Secrets / vars (set with `wrangler secret put <NAME>` — never commit keys):
//   AI_PROVIDER       "anthropic", "openai" or "gemini"
//   ANTHROPIC_API_KEY required when AI_PROVIDER=anthropic
//   OPENAI_API_KEY    required when AI_PROVIDER=openai
//   GEMINI_API_KEY    required when AI_PROVIDER=gemini (free tier via Google AI Studio)
//   AI_MODEL          optional override (defaults: claude-sonnet-4-5 / gpt-4o / gemini-3-flash-preview)
//   RESEND_API_KEY    required for /choose email
//   TO_EMAIL          address that receives the chosen code
//   ALLOWED_ORIGIN    the GitHub Pages origin allowed to call this worker
//                     (default "*" while testing)

const STYLE_BRIEFS = [
  {
    label: "Clean Light",
    description: "Airy white space, light background, one accent color, crisp sans-serif type.",
    brief: "an airy light theme: white/very light background, generous white space, a single restrained accent color, crisp modern sans-serif typography"
  },
  {
    label: "Bold Dark",
    description: "Dark background, strong contrast, confident headlines, minimal chrome.",
    brief: "a bold dark theme: near-black background, high-contrast text, one vivid accent color, large confident headlines, minimal decoration"
  },
  {
    label: "Soft Neutral",
    description: "Warm neutrals, soft shadows, rounded corners, calm and friendly.",
    brief: "a soft neutral theme: warm off-white/stone palette, soft shadows, rounded corners, friendly approachable typography, calm and uncluttered"
  }
];

export default {
  async fetch(request, env) {
    const origin = env.ALLOWED_ORIGIN || "*";
    const cors = {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    };
    if (request.method === "OPTIONS") return new Response(null, { headers: cors });
    if (request.method !== "POST") return json({ error: "POST only" }, 405, cors);

    const path = new URL(request.url).pathname;
    try {
      if (path === "/generate") return await generate(request, env, cors);
      if (path === "/choose") return await choose(request, env, cors);
      return json({ error: "Unknown endpoint" }, 404, cors);
    } catch (err) {
      return json({ error: String(err && err.message || err) }, 500, cors);
    }
  }
};

function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { "Content-Type": "application/json", ...(cors || {}) }
  });
}

async function generate(request, env, cors) {
  const { url, mirrorUrl } = await request.json();
  if (!url || !/^https?:\/\//i.test(url)) throw new Error("A valid http(s) URL is required");

  const pageRes = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; RevampTestBot/1.0)" },
    redirect: "follow"
  });
  if (!pageRes.ok) throw new Error("Could not fetch that site (" + pageRes.status + ")");
  let source = await pageRes.text();

  // Trim the source down to content-bearing markup for the model.
  source = source
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<svg[\s\S]*?<\/svg>/gi, "")
    .replace(/\s+/g, " ")
    .slice(0, 30000);

  // Optional style reference: a site the visitor wants theirs to mirror.
  // A failed mirror fetch must not block the redesign.
  let mirror = "";
  if (mirrorUrl && /^https?:\/\//i.test(mirrorUrl)) {
    try {
      const mirrorRes = await fetch(mirrorUrl, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; RevampTestBot/1.0)" },
        redirect: "follow"
      });
      if (mirrorRes.ok) {
        mirror = await mirrorRes.text();
        mirror = mirror
          .replace(/<script[\s\S]*?<\/script>/gi, "")
          .replace(/<style[\s\S]*?<\/style>/gi, "")
          .replace(/<svg[\s\S]*?<\/svg>/gi, "")
          .replace(/\s+/g, " ")
          .slice(0, 15000);
      }
    } catch (_) { /* ignore: generate without the mirror reference */ }
  }

  const samples = await Promise.all(STYLE_BRIEFS.map(async (s) => {
    const html = await callAI(env, buildPrompt(url, source, s.brief, mirrorUrl, mirror));
    return { label: s.label, description: s.description, html };
  }));
  return json({ samples }, 200, cors);
}

function buildPrompt(url, source, brief, mirrorUrl, mirror) {
  const mirrorSection = mirror
    ? [
        "Style reference: the user would like their redesign to mirror the look and feel of " + mirrorUrl + ".",
        "Mirror that site's layout patterns, color palette, typography style and overall vibe,",
        "but keep the original site's own real content (business name, services/products, contact details).",
        "Reference site HTML (trimmed):",
        mirror,
        ""
      ].join("\n")
    : "";
  return [
    "You are a senior web designer. Redesign the homepage of the website below",
    "as a single, self-contained HTML file with a modern, minimalistic look:",
    brief + ".",
    "",
    mirrorSection,
    "You are a senior web designer. Redesign the homepage of the website below",
    "as a single, self-contained HTML file with a modern, minimalistic look:",
    brief + ".",
    "",
    "Rules:",
    "- Output ONLY the complete HTML document. No explanations, no markdown fences.",
    "- All CSS must be inline in a <style> tag in the <head>. No external files, no JavaScript frameworks.",
    "- Keep the site's real business name, headline ideas, services/products and contact details from the source.",
    "- Reuse image URLs only if they appear in the source and fit the design; otherwise include 2-3 real photographic images that suit the site's subject, using https://picsum.photos/seed/<short-descriptive-seed>/1200/800 style URLs (vary the seed per image, e.g. hero, service, team, and size heroes around 1200x800 and smaller images around 800x600). Give every image descriptive alt text. CSS shapes/gradients are fine as accents, but the page should not feel imageless.",
    "- Make it responsive and genuinely good-looking: clear hierarchy, one primary call to action, footer with contact info.",
    "",
    "Source URL: " + url,
    "Source HTML (trimmed):",
    source
  ].join("\n");
}

async function callAI(env, prompt) {
  const provider = (env.AI_PROVIDER || "anthropic").toLowerCase();
  let raw;
  if (provider === "openai" || provider === "gemini") {
    // Gemini is reached through Google's OpenAI-compatible endpoint.
    const isGemini = provider === "gemini";
    const res = await fetch(isGemini
      ? "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"
      : "https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + (isGemini ? env.GEMINI_API_KEY : env.OPENAI_API_KEY)
      },
      body: JSON.stringify({
        model: env.AI_MODEL || (isGemini ? "gemini-3-flash-preview" : "gpt-4o"),
        max_tokens: 8000,
        messages: [{ role: "user", content: prompt }]
      })
    });
    if (!res.ok) throw new Error((isGemini ? "Gemini" : "OpenAI") + " returned " + res.status);
    const data = await res.json();
    raw = data.choices?.[0]?.message?.content || "";
  } else {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: env.AI_MODEL || "claude-sonnet-4-5",
        max_tokens: 8000,
        messages: [{ role: "user", content: prompt }]
      })
    });
    if (!res.ok) throw new Error("Anthropic returned " + res.status);
    const data = await res.json();
    raw = (data.content || []).map(b => b.text || "").join("");
  }
  // Models sometimes wrap output in ```html fences despite instructions.
  return raw.replace(/^\s*```(?:html)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
}

async function choose(request, env, cors) {
  const { sourceUrl, label, html, name, email, mirrorUrl } = await request.json();
  if (!html) throw new Error("Missing html");
  if (!env.RESEND_API_KEY || !env.TO_EMAIL) throw new Error("Email is not configured on the backend yet");

  const visitorEmail = typeof email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
  const visitorName = typeof name === "string" ? name.trim().slice(0, 120) : "";

  const attachment = {
    filename: "chosen-redesign.html",
    content: base64EncodeUtf8(html)
  };
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + env.RESEND_API_KEY
    },
    body: JSON.stringify({
      from: "Site Revamp Test <onboarding@resend.dev>",
      to: [env.TO_EMAIL],
      subject: "Chosen redesign: " + (label || "Design") + " for " + (sourceUrl || "submitted site"),
      ...(visitorEmail ? { reply_to: visitorEmail } : {}),
      text: [
        "A visitor picked a redesign on the Site Revamp test page.",
        "",
        "Submitted by: " + (visitorName || "(no name given)") + (visitorEmail ? " <" + visitorEmail + ">" : ""),
        "Source site: " + (sourceUrl || "(unknown)"),
        ...(mirrorUrl ? ["Mirror site: " + mirrorUrl] : []),
        "Chosen design: " + (label || "(unnamed)"),
        "",
        "The full HTML code is attached as chosen-redesign.html."
      ].join("\n"),
      attachments: [attachment]
    })
  });
  if (!res.ok) throw new Error("Resend returned " + res.status + ": " + (await res.text()).slice(0, 200));
  return json({ ok: true }, 200, cors);
}

function base64EncodeUtf8(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  bytes.forEach(b => { bin += String.fromCharCode(b); });
  return btoa(bin);
}
