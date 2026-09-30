/**
 * Optional NVIDIA NIM / integrate.api.nvidia.com prose for match articles.
 * Set NVIDIA_API_KEY (and optionally NVIDIA_MODEL). Falls back to caller on any error.
 */

const DEFAULT_URL = 'https://integrate.api.nvidia.com/v1/chat/completions';
/** Enrolled on typical build.nvidia.com keys; llama-3.3-70b-instruct returns 410 (EOL). */
const DEFAULT_MODEL = 'openai/gpt-oss-20b';

function extractJson(text) {
  const trimmed = text.trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fence ? fence[1].trim() : trimmed;
  return JSON.parse(raw);
}

/**
 * @param {object} facts — structured match facts from the daily script
 * @param {{ title: string, summary: string, body: string }} template — rule-based draft
 * @returns {Promise<{ title: string, summary: string, body: string } | null>}
 */
export async function nvidiaArticle(facts, template) {
  const key = process.env.NVIDIA_API_KEY?.trim();
  if (!key) return null;

  const url = process.env.NVIDIA_API_URL?.trim() || DEFAULT_URL;
  const model = process.env.NVIDIA_MODEL?.trim() || DEFAULT_MODEL;

  const system = `You write short news posts for the Bedfordshire Squash & Racketball Association website.
Use ONLY the facts provided. Do not invent players, scores, dates, teams, or ratings.
British English. No hype or exclamation marks. Do not call the match a final unless the facts say so. Two to four short paragraphs plus an optional single-sentence upset note.
Return JSON only: {"title":"...","summary":"...","body":"..."}
Summary max 280 characters. Body is Markdown (paragraphs separated by blank lines). Keep any markdown link exactly as given in facts.`;

  const user = `Facts (JSON):
${JSON.stringify(facts, null, 2)}

Template draft (you may rephrase but must stay factual):
Title: ${template.title}
Summary: ${template.summary}
Body:
${template.body}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: 0.25,
      max_tokens: 900,
      top_p: 0.9,
    }),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`NVIDIA API ${response.status}: ${text.slice(0, 300)}`);
  }

  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error('NVIDIA API returned non-JSON');
  }

  const content = payload.choices?.[0]?.message?.content;
  if (!content) throw new Error('NVIDIA API returned empty content');

  const parsed = extractJson(content);
  if (!parsed.title || !parsed.summary || !parsed.body) {
    throw new Error('NVIDIA JSON missing title, summary, or body');
  }

  return {
    title: String(parsed.title).trim(),
    summary: String(parsed.summary).trim().slice(0, 320),
    body: String(parsed.body).trim(),
  };
}
