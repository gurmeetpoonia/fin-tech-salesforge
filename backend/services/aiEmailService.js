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
  originalBody,
  audienceLabel,
}) => {
  try {
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      throw new Error("GEMINI_API_KEY is not configured");
    }

    const ai = new GoogleGenAI({ apiKey });

    const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";

    const audiencePrompt = resolveAudiencePrompt(audienceLabel);

    const prompt = `You are generating the email body for a B2B campaign.

Audience: ${audienceLabel || "General Leads"}
Audience-specific instruction:
${audiencePrompt}

Authoritative lead data from the application database:
Name: ${name || ""}
Company: ${company || ""}
Job Title: ${jobTitle || ""}
Industry: ${industry || ""}
Location: ${location || ""}

Existing campaign body/template:
${originalBody || ""}

Rules:
- Treat the lead data above as the only source of factual information about this person or company.
- You may personalize wording, but you must never invent names, roles, companies, industries, locations, achievements, products, pain points, customers, numbers, or other facts.
- Follow the audience-specific instruction above.
- Preserve the campaign's intended purpose.
- Keep the email concise, natural, professional, and suitable for B2B outreach.
- Do not add a subject line, greeting metadata, explanations, or markdown fences.
- Return only the final email body.`;

    const response = await ai.models.generateContent({
      model,
      contents: [{ role: "user", parts: [{ text: prompt }] }],
    });

    const output = response.text?.trim();

    if (!output) {
      throw new Error("Gemini returned an empty response");
    }

    return { output };
  } catch (error) {
    console.error(
      "AI Campaign Personalization error:",
      error.message
    );

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
