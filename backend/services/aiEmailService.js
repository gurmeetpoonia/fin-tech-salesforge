const axios = require("axios");
const { GoogleGenAI } = require("@google/genai");

const AI_URL = process.env.AI_URL;
const TIMEOUT = process.env.AI_TIMEOUT || 5000;

const axiosInstance = axios.create({
  timeout: TIMEOUT,
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const isTransientAiError = (err) => {
  const msg = String(err?.message || "");
  return (
    /"code":\s*(429|500|503|504)|UNAVAILABLE|RESOURCE_EXHAUSTED|DEADLINE_EXCEEDED|timed out|ECONNRESET|ETIMEDOUT|fetch failed/i.test(msg) ||
    [429, 500, 503, 504].includes(Number(err?.status || err?.code))
  );
};

const withTimeout = (promise, ms) =>
  Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Gemini request timed out after ${ms}ms`)), ms)
    ),
  ]);

// Retries transient Gemini errors (503/429/timeouts) and optionally falls back
// to a second model so a short Google overload doesn't block campaign emails.
const generateWithRetry = async (ai, request) => {
  const primary = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  const fallback = process.env.GEMINI_FALLBACK_MODEL;
  const models = fallback && fallback !== primary ? [primary, primary, fallback] : [primary, primary];
  const timeoutMs = Number(process.env.GEMINI_REQUEST_TIMEOUT_MS || 20000);

  let lastError;
  for (let attempt = 0; attempt < models.length; attempt++) {
    try {
 console.log(
      `[Gemini] Attempt ${attempt + 1}/${models.length} using model: ${models[attempt]}`
    );
      return await withTimeout(
        ai.models.generateContent({ ...request, model: models[attempt] }),
        timeoutMs
      );
    } catch (err) {
      lastError = err;
      if (!isTransientAiError(err) || attempt === models.length - 1) break;
      await sleep(1000 * 2 ** attempt); // 1s, then 2s
    }
  }
  throw lastError;
};

/*
  Outreach message generation
 */
exports.generateOutreachMessage = async ({ name, company, purpose }) => {
  try {
    const payload = {
      type: "outreach",
      prompt: `Write a short professional outreach message.
Name: ${name}
Company: ${company}
Purpose: ${purpose}`,
    };

    const response = await axiosInstance.post(AI_URL, payload);

    return {
      output: response.data.output || response.data,
    };
  } catch (error) {
    console.error("AI Outreach error:", error.message);
    throw new Error("AI outreach service unavailable");
  }
};

/*
 AI-powered campaign personalization
 */
const AUDIENCE_PROMPTS = {
  status_new: "Write a professional B2B email for a new lead. Introduce the value clearly, establish relevance, and use a low-friction call to action without assuming prior contact.",
  status_contacted: "Write a concise follow-up for a contacted lead. Build naturally on the fact that outreach has already occurred, provide useful value, and suggest a clear next step without being repetitive or pushy.",
  status_in_progress: "Write a focused B2B email for a lead currently in progress. Move the existing sales conversation forward with relevant value and a specific next step.",
  status_converted: "Write a professional relationship-oriented email for a converted lead. Reinforce the value of the relationship and suggest an appropriate next step without treating the lead as a cold prospect.",
  status_closed: "Write a respectful B2B email for a closed lead. Keep the message concise and context-aware, and only suggest a next step if it is genuinely appropriate.",
  status_lost: "Write a thoughtful re-engagement email for a lost lead. Acknowledge that the previous opportunity did not progress without inventing reasons, offer relevant value, and use a low-pressure call to action.",
  all: "Write professional B2B outreach appropriate for a general lead audience.",
  default: "Write professional, concise B2B outreach appropriate for the selected campaign audience.",
};

const resolveAudiencePrompt = ({ audienceType = "all", audienceContext = {} } = {}) => {
  if (audienceType === "status") {
    const key = String(audienceContext.status || "").toLowerCase();
    const statusKey = `status_${key}`;
    return AUDIENCE_PROMPTS[statusKey] || AUDIENCE_PROMPTS.default;
  }

  if (audienceType === "all") return AUDIENCE_PROMPTS.all;

  if (audienceType === "tag") {
    return "Write B2B outreach specifically relevant to the selected tag audience. Use the tag context to shape the message, but do not claim facts about the lead that are not supplied.";
  }

  if (audienceType === "segment") {
    return "Write B2B outreach specifically relevant to the saved segment. Use the segment name and its actual filters/conditions to shape the message while using only supplied lead data as factual information.";
  }

  if (audienceType === "score") {
    return "Write B2B outreach appropriate to the selected lead-score range. Use the score audience context to calibrate relevance and sales intent, but do not mention or invent a score-based fact unless it is useful and supported.";
  }

  return AUDIENCE_PROMPTS.default;
};

exports.personalizeCampaignEmail = async ({
  name,
  company,
  jobTitle,
  industry,
  location,
  leadStatus,
  leadScore,
  campaignName,
  campaignDescription,
  audienceLabel,
  audienceType,
  audienceContext,
  stepNumber,
}) => {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("GEMINI_API_KEY is not configured");

    const ai = new GoogleGenAI({ apiKey });
    const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
    const normalizedAudienceType = audienceType || "all";
    const normalizedAudienceContext =
      audienceContext && typeof audienceContext === "object"
        ? audienceContext
        : {};
    const audiencePrompt = resolveAudiencePrompt({
      audienceType: normalizedAudienceType,
      audienceContext: normalizedAudienceContext,
    });

    const audienceContextText = JSON.stringify(normalizedAudienceContext);

    const prompt = `You are generating one personalized B2B campaign email for one specific lead.

Campaign: ${campaignName || "Sales outreach"}
Campaign context: ${campaignDescription || "Professional B2B outreach"}
Step: ${stepNumber || 1}
Audience type: ${normalizedAudienceType}
Audience label: ${audienceLabel || "General Leads"}
Audience context and conditions: ${audienceContextText}
Audience-specific instruction:
${audiencePrompt}

Authoritative lead data from the application database:
Name: ${name || ""}
Company: ${company || ""}
Job Title: ${jobTitle || ""}
Industry: ${industry || ""}
Location: ${location || ""}
Lead Status: ${leadStatus || ""}
Lead Score: ${leadScore ?? ""}

Rules:
- Generate a concise, natural, professional B2B email for THIS lead.
- Use the audience type and audience context/conditions to make the message relevant to this specific campaign audience.
- Use only the lead data and audience context supplied above as factual information.
- Never invent achievements, products, pain points, customers, numbers, relationships, reasons for status changes, or other facts.
- Make the wording meaningfully personalized to the available lead data.
- Include a clear but non-pushy call to action.
- Return ONLY valid JSON with exactly two string fields: "subject" and "body".
- Do not include markdown fences or explanations.
- The body should be ready to send as HTML-safe plain email text.`;

        const response = await generateWithRetry(ai, {
      contents: [{ role: "user", parts: [{ text: prompt }] }],
    });

    const raw = response.text?.trim();
    if (!raw) throw new Error("Gemini returned an empty response");

    const cleaned = raw.replace(/^\`\`\`(?:json)?\s*/i, "").replace(/\s*\`\`\`$/i, "").trim();
    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      throw new Error("Gemini returned invalid email JSON");
    }

    if (!parsed?.subject?.trim() || !parsed?.body?.trim()) {
      throw new Error("Gemini returned incomplete email content");
    }

    return {
      subject: parsed.subject.trim(),
      body: parsed.body.trim(),
    };
  } catch (error) {
    console.error("AI Campaign Personalization error:", error.message);
    throw new Error("AI campaign personalization service unavailable");
  }
};
/*
 Content summarization
 */
exports.summarizeContent = async (text) => {
  try {
    const payload = {
      type: "summarize",
      prompt: `Summarize the following text:\n${text}`,
    };

    const response = await axiosInstance.post(AI_URL, payload);

    return {
      output: response.data.output || response.data,
    };
  } catch (error) {
    console.error("AI Summary error:", error.message);
    throw new Error("AI summarization service unavailable");
  }
};
