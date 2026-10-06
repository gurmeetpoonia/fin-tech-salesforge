const axios = require("axios");
const { GoogleGenAI } = require("@google/genai");


const TIMEOUT = process.env.AI_TIMEOUT || 5000;

const axiosInstance = axios.create({
  timeout: TIMEOUT,
});


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
  qualified: "Write a professional qualification-focused B2B email that helps advance a qualified lead toward the next sales conversation.",
  hot: "Write a direct, confident B2B sales email focused on conversion and a clear next step for a hot lead.",
  followup: "Write a concise, helpful follow-up email that references the existing outreach context and asks for the next step without being pushy.",
  highpriority: "Write highly personalized, relevant B2B outreach for a high-priority lead, emphasizing the most useful value proposition and a clear call to action.",
  all: "Write professional B2B outreach appropriate for a general lead audience.",
  default: "Write professional, concise B2B outreach appropriate for the selected campaign audience.",
};

const resolveAudiencePrompt = (audienceLabel = "") => {
  const key = String(audienceLabel)
    .toLowerCase()
    .replace(/[^a-z]/g, "");
  if (key.includes("qualified")) return AUDIENCE_PROMPTS.qualified;
  if (key.includes("hot")) return AUDIENCE_PROMPTS.hot;
  if (key.includes("followup") || key.includes("followup")) return AUDIENCE_PROMPTS.followup;
  if (key.includes("highpriority") || key.includes("priority")) return AUDIENCE_PROMPTS.highpriority;
  if (key === "all" || key.includes("allleads")) return AUDIENCE_PROMPTS.all;
  return AUDIENCE_PROMPTS.default;
};

exports.personalizeCampaignEmail = async ({
  name,
  company,
  jobTitle,
  industry,
  location,
  campaignName,
  campaignDescription,
  audienceLabel,
  stepNumber,
}) => {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("GEMINI_API_KEY is not configured");

    const ai = new GoogleGenAI({ apiKey });
    const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
    const audiencePrompt = resolveAudiencePrompt(audienceLabel);

    const prompt = `You are generating one personalized B2B campaign email for one specific lead.

Campaign: ${campaignName || "Sales outreach"}
Campaign context: ${campaignDescription || "Professional B2B outreach"}
Step: ${stepNumber || 1}
Audience: ${audienceLabel || "General Leads"}
Audience-specific instruction:
${audiencePrompt}

Authoritative lead data from the application database:
Name: ${name || ""}
Company: ${company || ""}
Job Title: ${jobTitle || ""}
Industry: ${industry || ""}
Location: ${location || ""}

Rules:
- Generate a concise, natural, professional B2B email for THIS lead.
- Use only the lead data supplied above as factual information.
- Never invent achievements, products, pain points, customers, numbers, relationships, or other facts.
- Make the wording meaningfully personalized to the available lead data.
- Include a clear but non-pushy call to action.
- Return ONLY valid JSON with exactly two string fields: "subject" and "body".
- Do not include markdown fences or explanations.
- The body should be ready to send as HTML-safe plain email text.`;

    const response = await ai.models.generateContent({
      model,
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
