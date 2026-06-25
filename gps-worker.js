/**
 * GPS Opositor PN — Cloudflare Worker
 * Proxy multi-IA gratuito: normaliza todas las APIs al mismo formato
 * Deploy: workers.cloudflare.com → Create Worker → pega este código → Deploy
 *
 * IAs soportadas (todas con tier gratuito):
 *   gemini      → Google AI Studio (aistudio.google.com)
 *   groq        → Groq Console (console.groq.com)
 *   openrouter  → OpenRouter (openrouter.ai) — muchos modelos free
 *   mistral     → Mistral AI (console.mistral.ai) — mistral-small gratis
 *   cohere      → Cohere (cohere.com) — command-r gratis
 *   together    → Together AI (api.together.xyz) — modelos open source
 *   deepinfra   → DeepInfra (deepinfra.com) — modelos open source gratis
 *   anthropic   → Anthropic (console.anthropic.com) — de pago pero alta calidad
 *
 * El HTML envía: { provider, model, key, prompt, max_tokens, images? }
 * El Worker responde: { text } o { error }
 */

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};

export default {
  async fetch(request, env) {
    // Preflight CORS
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (request.method !== "POST") {
      return json({ error: "Solo POST" }, 405);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: "JSON inválido" }, 400);
    }

    const { provider, model, key, prompt, max_tokens = 1200, images } = body;

    if (!provider || !key || !prompt) {
      return json({ error: "Faltan campos: provider, key, prompt" }, 400);
    }

    try {
      let text;
      switch (provider) {
        case "gemini":
          text = await callGemini(key, model || "gemini-1.5-flash", prompt, max_tokens, images);
          break;
        case "groq":
          text = await callGroq(key, model || "llama-3.1-70b-versatile", prompt, max_tokens);
          break;
        case "openrouter":
          text = await callOpenRouter(key, model || "mistralai/mistral-7b-instruct:free", prompt, max_tokens);
          break;
        case "mistral":
          text = await callMistral(key, model || "mistral-small-latest", prompt, max_tokens);
          break;
        case "cohere":
          text = await callCohere(key, model || "command-r", prompt, max_tokens);
          break;
        case "together":
          text = await callTogether(key, model || "meta-llama/Llama-3-8b-chat-hf", prompt, max_tokens);
          break;
        case "deepinfra":
          text = await callDeepInfra(key, model || "meta-llama/Meta-Llama-3.1-70B-Instruct", prompt, max_tokens);
          break;
        case "anthropic":
          text = await callAnthropic(key, model || "claude-haiku-4-5-20251001", prompt, max_tokens, images);
          break;
        default:
          return json({ error: `Proveedor desconocido: ${provider}` }, 400);
      }
      return json({ text });
    } catch (e) {
      return json({ error: e.message || "Error desconocido" }, 500);
    }
  },
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: CORS_HEADERS });
}

// ── Gemini ────────────────────────────────────────────────
async function callGemini(key, model, prompt, max_tokens, images) {
  const parts = [];
  if (images && images.length) {
    images.forEach((img, i) => {
      parts.push({ text: `--- Foto ${i + 1}/${images.length} ---` });
      parts.push({ inline_data: { mime_type: img.mediaType, data: img.base64 } });
    });
  }
  parts.push({ text: prompt });

  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: { maxOutputTokens: max_tokens, temperature: 0.7 },
      }),
    }
  );
  const d = await r.json();
  if (!r.ok) throw new Error(`Gemini ${r.status}: ${d.error?.message || JSON.stringify(d)}`);
  const text = d.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Gemini: respuesta vacía");
  return text;
}

// ── Groq ──────────────────────────────────────────────────
async function callGroq(key, model, prompt, max_tokens) {
  const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model,
      max_tokens: Math.min(max_tokens, 8000),
      messages: [{ role: "user", content: prompt }],
      temperature: 0.7,
    }),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(`Groq ${r.status}: ${d.error?.message || JSON.stringify(d)}`);
  const text = d.choices?.[0]?.message?.content;
  if (!text) throw new Error("Groq: respuesta vacía");
  return text;
}

// ── OpenRouter ────────────────────────────────────────────
// Modelos free: mistralai/mistral-7b-instruct:free, meta-llama/llama-3-8b-instruct:free
// microsoft/phi-3-mini-128k-instruct:free, google/gemma-2-9b-it:free
async function callOpenRouter(key, model, prompt, max_tokens) {
  const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
      "HTTP-Referer": "https://gps-opositor-pn.app",
      "X-Title": "GPS Opositor PN",
    },
    body: JSON.stringify({
      model,
      max_tokens,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(`OpenRouter ${r.status}: ${d.error?.message || JSON.stringify(d)}`);
  const text = d.choices?.[0]?.message?.content;
  if (!text) throw new Error("OpenRouter: respuesta vacía");
  return text;
}

// ── Mistral ───────────────────────────────────────────────
async function callMistral(key, model, prompt, max_tokens) {
  const r = await fetch("https://api.mistral.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model,
      max_tokens,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(`Mistral ${r.status}: ${d.error?.message || JSON.stringify(d)}`);
  const text = d.choices?.[0]?.message?.content;
  if (!text) throw new Error("Mistral: respuesta vacía");
  return text;
}

// ── Cohere ────────────────────────────────────────────────
async function callCohere(key, model, prompt, max_tokens) {
  const r = await fetch("https://api.cohere.com/v1/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model,
      max_tokens,
      message: prompt,
    }),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(`Cohere ${r.status}: ${d.message || JSON.stringify(d)}`);
  const text = d.text;
  if (!text) throw new Error("Cohere: respuesta vacía");
  return text;
}

// ── Together AI ───────────────────────────────────────────
async function callTogether(key, model, prompt, max_tokens) {
  const r = await fetch("https://api.together.xyz/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model,
      max_tokens,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(`Together ${r.status}: ${d.error?.message || JSON.stringify(d)}`);
  const text = d.choices?.[0]?.message?.content;
  if (!text) throw new Error("Together: respuesta vacía");
  return text;
}

// ── DeepInfra ─────────────────────────────────────────────
async function callDeepInfra(key, model, prompt, max_tokens) {
  const r = await fetch(`https://api.deepinfra.com/v1/openai/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model,
      max_tokens,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(`DeepInfra ${r.status}: ${d.error?.message || JSON.stringify(d)}`);
  const text = d.choices?.[0]?.message?.content;
  if (!text) throw new Error("DeepInfra: respuesta vacía");
  return text;
}

// ── Anthropic ─────────────────────────────────────────────
async function callAnthropic(key, model, prompt, max_tokens, images) {
  let content;
  if (images && images.length) {
    content = [];
    images.forEach((img, i) => {
      content.push({ type: "text", text: `--- Foto ${i + 1}/${images.length} ---` });
      content.push({ type: "image", source: { type: "base64", media_type: img.mediaType, data: img.base64 } });
    });
    content.push({ type: "text", text: prompt });
  } else {
    content = prompt;
  }

  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens,
      messages: [{ role: "user", content }],
    }),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(`Anthropic ${r.status}: ${d.error?.message || JSON.stringify(d)}`);
  const text = d.content?.[0]?.text;
  if (!text) throw new Error("Anthropic: respuesta vacía");
  return text;
}
