const { prisma } = require("../config/postgres");
const DEFAULT_CAMPAIGN_NAME = "Auto Welcome Campaign";

const DEFAULT_SUBJECT = "Welcome, {{first_name}}!";

const DEFAULT_BODY =
  "<p>Hi {{first_name}},</p>" +
  "<p>Thanks for your interest — we'll be in touch shortly.</p>";

const createDefaultCampaign = async (orgId, userId) => {
  if (!orgId) {
    throw new Error("Organization ID is required to create a campaign.");
  }

  if (!userId) {
    throw new Error("User ID is required to create a campaign.");
  }

  const now = new Date();
  const currentTime = now.toTimeString().slice(0, 5);

  const steps = [
    {
      day: 0,
      time: currentTime,
      subject: DEFAULT_SUBJECT,
      body: DEFAULT_BODY,
    },
  ];

  const existingCampaign = await prisma.workflow.findFirst({
    where: {
      orgId,
      active: true,
      trigger: "SCHEDULED_TIME",
      name: DEFAULT_CAMPAIGN_NAME,
    },
  });

  if (existingCampaign) {
    const existingSequence = await prisma.sequence.findUnique({
      where: { workflowId: existingCampaign.id },
    });

    if (existingSequence) {
      return existingCampaign;
    }
  }

  const campaign = await prisma.workflow.create({
    data: {
      orgId,
      userId,
      name: DEFAULT_CAMPAIGN_NAME,
      description: "Automatically created to welcome new leads.",
      trigger: "SCHEDULED_TIME",
      conditions: {
        segment: null,
        subject: DEFAULT_SUBJECT,
        body: DEFAULT_BODY,
        audience: {
          type: "all",
        },
        steps,
        type: "email",
        schedule: null,
        budget: null,
        status: "running",
      },
      actions: [{ type: "SEND_EMAIL" }],
      active: true,
    },
  });

  await prisma.sequence.create({
    data: {
      orgId,
      userId,
      workflowId: campaign.id,
      name: `Campaign: ${campaign.name}`,
      description: campaign.description,
      status: "ACTIVE",
      steps,
    },
  });

  return campaign;
};

/**
 * Normalize old/new audience formats.
 *
 * Old:
 *   "all"
 *
 * New:
 *   { type: "all" }
 *   { type: "tag", tagId: 1 }
 *   { type: "status", status: "new" }
 *   { type: "segment", savedSearchId: 1 }
 */
const normalizeAudience = (audience) => {
  if (!audience) {
    return { type: "all" };
  }

  if (typeof audience === "string") {
    return { type: audience };
  }

  if (typeof audience === "object") {
    return audience;
  }

  return { type: "all" };
};

const buildAudienceLeadWhere = async (audience, orgId) => {
  const normalizedAudience = normalizeAudience(audience);
  const leadWhere = { orgId, email: { not: "" } };

  if (normalizedAudience.type === "tag") {
    const tagId = Number(normalizedAudience.tagId);
    if (!Number.isInteger(tagId) || tagId <= 0) return null;
    leadWhere.tags = { some: { tagId } };
    return leadWhere;
  }

  if (normalizedAudience.type === "status") {
    if (!normalizedAudience.status) return null;
    leadWhere.status = normalizedAudience.status;
    return leadWhere;
  }

  if (normalizedAudience.type === "score") {
    const operator = String(normalizedAudience.operator || "").toLowerCase();
    const value = Number(normalizedAudience.value);
    const min = normalizedAudience.min !== undefined && normalizedAudience.min !== "" ? Number(normalizedAudience.min) : null;
    const max = normalizedAudience.max !== undefined && normalizedAudience.max !== "" ? Number(normalizedAudience.max) : null;

    if (operator && Number.isFinite(value)) {
      if (operator === "gt" || operator === "gte" || operator === "lt" || operator === "lte") {
        leadWhere.score = { [operator]: value };
        return leadWhere;
      }
    }

    if (min !== null || max !== null) {
      if ((min !== null && !Number.isFinite(min)) || (max !== null && !Number.isFinite(max))) return null;
      if (min !== null && max !== null && min > max) return null;
      leadWhere.score = {};
      if (min !== null) leadWhere.score.gte = min;
      if (max !== null) leadWhere.score.lte = max;
      return leadWhere;
    }

    return null;
  }

  if (normalizedAudience.type !== "all") return null;
  return leadWhere;
};

const getCampaignAudienceCount = async (audience, orgId) => {
  const normalizedAudience = normalizeAudience(audience);
  if (normalizedAudience.type === "segment") {
    const leads = await getMatchingCampaignLeads(audience, orgId);
    return leads.length;
  }

  const leadWhere = await buildAudienceLeadWhere(audience, orgId);
  if (!leadWhere) return 0;
  return prisma.lead.count({ where: leadWhere });
};

const ensureCampaignSequence = async ({ campaign, orgId, userId, steps }) => {
  let sequence = await prisma.sequence.findUnique({
    where: { workflowId: campaign.id },
  });

  if (!sequence) {
    sequence = await prisma.sequence.findFirst({
      where: { orgId, name: `Campaign: ${campaign.name}` },
    });
  }

  if (sequence) {
    return prisma.sequence.update({
      where: { id: sequence.id },
      data: {
        workflowId: campaign.id,
        orgId,
        userId,
        name: `Campaign: ${campaign.name}`,
        description: campaign.description || null,
        status: "ACTIVE",
        steps,
      },
    });
  }

  return prisma.sequence.create({
    data: {
      orgId,
      userId,
      workflowId: campaign.id,
      name: `Campaign: ${campaign.name}`,
      description: campaign.description || null,
      status: "ACTIVE",
      steps,
    },
  });
};

const reconcileLeadWithActiveCampaigns = async (leadId, orgId, userId) => {
  const lead = await prisma.lead.findFirst({
    where: { id: Number(leadId), orgId },
  });

  if (!lead || !lead.email) {
    return { enrolled: 0, paused: 0, campaignsChecked: 0 };
  }

  const campaigns = await prisma.workflow.findMany({
    where: {
      orgId,
      active: true,
      trigger: "SCHEDULED_TIME",
    },
    orderBy: { id: "asc" },
  });

  let enrolled = 0;
  let paused = 0;

  for (const campaign of campaigns) {
    const conditions = campaign.conditions || {};
    if (conditions.status !== "running") continue;

    const sequence = await ensureCampaignSequence({
      campaign,
      orgId,
      userId: userId || campaign.userId,
      steps: Array.isArray(conditions.steps) ? conditions.steps : [],
    });

    const matches = await leadMatchesAudience(lead, conditions.audience, orgId);
    const existing = await prisma.sequenceEnrollment.findUnique({
      where: {
        sequenceId_leadId: { sequenceId: sequence.id, leadId: lead.id },
      },
    });

    if (matches) {
      if (!existing) {
        await prisma.sequenceEnrollment.create({
          data: {
            orgId,
            sequenceId: sequence.id,
            leadId: lead.id,
            email: lead.email,
            status: "ACTIVE",
            currentStep: 0,
            steps: sequence.steps,
            nextRunAt: new Date(),
          },
        });
        enrolled += 1;
      } else if (existing.status === "PAUSED") {
        await prisma.sequenceEnrollment.update({
          where: { id: existing.id },
          data: {
            status: "ACTIVE",
            nextRunAt: new Date(),
            email: lead.email,
          },
        });
        enrolled += 1;
      }
    } else if (existing?.status === "ACTIVE") {
      await prisma.sequenceEnrollment.update({
        where: { id: existing.id },
        data: { status: "PAUSED", nextRunAt: null },
      });
      paused += 1;
    }
  }

  return { enrolled, paused, campaignsChecked: campaigns.length };
};

const reconcileCampaignAudience = async (campaignId, orgId, userId) => {
  const campaign = await prisma.workflow.findFirst({
    where: { id: Number(campaignId), orgId },
  });

  if (!campaign || !campaign.active || campaign.conditions?.status !== "running") {
    return { enrolled: 0, paused: 0, campaignsChecked: 0 };
  }

  const conditions = campaign.conditions || {};
  const steps = Array.isArray(conditions.steps) ? conditions.steps : [];
  const sequence = await ensureCampaignSequence({
    campaign,
    orgId,
    userId: userId || campaign.userId,
    steps,
  });
  const matchingLeads = await getMatchingCampaignLeads(conditions.audience, orgId);
  const matchingIds = new Set(matchingLeads.map((lead) => lead.id));
  const enrollments = await prisma.sequenceEnrollment.findMany({
    where: { sequenceId: sequence.id, status: { in: ["ACTIVE", "PAUSED"] } },
  });

  let enrolled = 0;
  let paused = 0;

  for (const enrollment of enrollments) {
    if (enrollment.leadId && !matchingIds.has(enrollment.leadId) && enrollment.status === "ACTIVE") {
      await prisma.sequenceEnrollment.update({
        where: { id: enrollment.id },
        data: { status: "PAUSED", nextRunAt: null },
      });
      paused += 1;
    }
  }

  for (const lead of matchingLeads) {
    const existing = await prisma.sequenceEnrollment.findUnique({
      where: { sequenceId_leadId: { sequenceId: sequence.id, leadId: lead.id } },
    });

    if (!existing) {
      await prisma.sequenceEnrollment.create({
        data: {
          orgId,
          sequenceId: sequence.id,
          leadId: lead.id,
          email: lead.email,
          status: "ACTIVE",
          currentStep: 0,
          steps: sequence.steps,
          nextRunAt: new Date(),
        },
      });
      enrolled += 1;
    } else if (existing.status === "PAUSED") {
      await prisma.sequenceEnrollment.update({
        where: { id: existing.id },
        data: { status: "ACTIVE", nextRunAt: new Date(), email: lead.email },
      });
      enrolled += 1;
    }
  }

  return { enrolled, paused, campaignsChecked: 1 };
};

/**
 * Safely compare values.
 */
const valuesMatch = (leadValue, filterValue) => {
  if (
    leadValue === null ||
    leadValue === undefined ||
    filterValue === null ||
    filterValue === undefined
  ) {
    return false;
  }

  return (
    String(leadValue).trim().toLowerCase() ===
    String(filterValue).trim().toLowerCase()
  );
};

/**
 * Match one lead against a saved-search filter object.
 *
 * Supported simple filters:
 *   { field: "status", value: "new" }
 *
 *   { status: "new" }
 *
 *   { industry: "Technology" }
 *
 *   { status: ["new", "qualified"] }
 *
 * Also supports:
 *   { conditions: [...] }
 *
 * If multiple fields exist, ALL conditions must match.
 */
const getAudienceFieldValue = (lead, field) => {
  if (["tagId", "tagIds", "tags"].includes(field)) {
    const tagIds = Array.isArray(lead?.tags)
      ? lead.tags.map((entry) => Number(entry?.tagId ?? entry?.tag?.id ?? entry?.id)).filter(Number.isFinite)
      : [];
    return tagIds;
  }

  return lead?.[field];
};

const compareAudienceField = (actual, operator, expected) => {
  if (Array.isArray(actual)) {
    const values = actual;
    const normalized = String(operator || "equals").toLowerCase();

    if (normalized === "not_equals" || normalized === "neq") {
      return values.every((value) => !compareAudienceValue(value, "equals", expected));
    }

    return values.some((value) => compareAudienceValue(value, normalized, expected));
  }

  return compareAudienceValue(actual, operator, expected);
};

const matchesSavedSearchFilters = (lead, filters) => {
  if (!filters || typeof filters !== "object") return true;

  const evaluateCondition = (condition) => {
    if (!condition || typeof condition !== "object") return true;

    if (Array.isArray(condition.conditions)) {
      const logic = String(condition.logic || "AND").toUpperCase();
      const results = condition.conditions.map(evaluateCondition);
      return logic === "OR" ? results.some(Boolean) : results.every(Boolean);
    }

    if (condition.field && condition.operator) {
      return compareAudienceField(
        getAudienceFieldValue(lead, condition.field),
        condition.operator,
        condition.value
      );
    }

    if (condition.field) {
      const actual = getAudienceFieldValue(lead, condition.field);
      const expected = condition.value;
      if (Array.isArray(expected)) {
        return expected.some((value) => compareAudienceField(actual, "equals", value));
      }
      return compareAudienceField(actual, "equals", expected);
    }

    const entries = Object.entries(condition).filter(
      ([key]) => !["id", "name", "resource", "logic", "operator", "conditions"].includes(key)
    );

    return entries.every(([field, expected]) => {
      const actual = getAudienceFieldValue(lead, field);

      if (Array.isArray(expected)) {
        return expected.some((value) => compareAudienceField(actual, "equals", value));
      }

      if (expected && typeof expected === "object" && !Array.isArray(expected)) {
        if (expected.operator) {
          return compareAudienceField(actual, expected.operator, expected.value);
        }
        if (expected.value !== undefined) {
          return compareAudienceField(actual, "equals", expected.value);
        }
      }

      return compareAudienceField(actual, "equals", expected);
    });
  };

  return evaluateCondition(filters);
};

const compareAudienceValue = (actual, operator, expected) => {
  const normalized = String(operator || "equals").toLowerCase();
  if (["gt", "gte", "lt", "lte", "greater_than", "greater_or_equal", "less_than", "less_or_equal"].includes(normalized)) {
    const a = Number(actual);
    const b = Number(expected);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
    if (normalized === "gt" || normalized === "greater_than") return a > b;
    if (normalized === "gte" || normalized === "greater_or_equal") return a >= b;
    if (normalized === "lt" || normalized === "less_than") return a < b;
    return a <= b;
  }

  if (normalized === "contains") {
    return actual != null && String(actual).toLowerCase().includes(String(expected).toLowerCase());
  }
  if (normalized === "starts_with") {
    return actual != null && String(actual).toLowerCase().startsWith(String(expected).toLowerCase());
  }
  if (normalized === "ends_with") {
    return actual != null && String(actual).toLowerCase().endsWith(String(expected).toLowerCase());
  }
  if (normalized === "not_equals" || normalized === "neq") {
    return !valuesMatch(actual, expected);
  }
  return valuesMatch(actual, expected);
};

/**
 * Check whether a lead matches a campaign audience.
 */
const leadMatchesAudience = async (lead, audience, orgId) => {
  const normalizedAudience = normalizeAudience(audience);

  const evaluateCondition = (condition) => {
    if (!condition || typeof condition !== "object") return true;

    if (Array.isArray(condition.conditions)) {
      const logic = String(condition.logic || "AND").toUpperCase();
      const results = condition.conditions.map(evaluateCondition);
      return logic === "OR" ? results.some(Boolean) : results.every(Boolean);
    }

    if (condition.field) {
      return compareAudienceField(
        getAudienceFieldValue(lead, condition.field),
        condition.operator || "equals",
        condition.value
      );
    }

    return Object.entries(condition)
      .filter(([key]) => !["id", "name", "resource", "logic", "conditions"].includes(key))
      .every(([field, expected]) => {
        const actual = getAudienceFieldValue(lead, field);
        if (expected && typeof expected === "object" && !Array.isArray(expected)) {
          return compareAudienceField(actual, expected.operator || "equals", expected.value);
        }
        if (Array.isArray(expected)) {
          return expected.some((value) => compareAudienceField(actual, "equals", value));
        }
        return compareAudienceField(actual, "equals", expected);
      });
  };

  if (normalizedAudience.type === "all") {
    return Array.isArray(normalizedAudience.conditions)
      ? evaluateCondition({ conditions: normalizedAudience.conditions, logic: normalizedAudience.logic || "AND" })
      : true;
  }

  let primaryMatches = false;
  switch (normalizedAudience.type) {
    case "status":
      primaryMatches = valuesMatch(lead.status, normalizedAudience.status);
      break;
    case "tag": {
      const tagId = Number(normalizedAudience.tagId);
      primaryMatches = Number.isInteger(tagId) && tagId > 0 &&
        Array.isArray(lead.tags) && lead.tags.some((entry) => Number(entry.tagId) === tagId);
      break;
    }
    case "score":
      if (normalizedAudience.operator) {
        primaryMatches = compareAudienceValue(lead.score, normalizedAudience.operator, normalizedAudience.value);
      } else if (normalizedAudience.min !== undefined || normalizedAudience.max !== undefined) {
        const min = normalizedAudience.min !== "" && normalizedAudience.min !== undefined ? Number(normalizedAudience.min) : null;
        const max = normalizedAudience.max !== "" && normalizedAudience.max !== undefined ? Number(normalizedAudience.max) : null;
        primaryMatches = (min === null || (Number.isFinite(min) && Number(lead.score) >= min)) &&
          (max === null || (Number.isFinite(max) && Number(lead.score) <= max));
      }
      break;
    case "segment": {
      const savedSearchId = Number(normalizedAudience.savedSearchId);
      if (!Number.isInteger(savedSearchId) || savedSearchId <= 0) return false;
      const savedSearch = await prisma.savedSearch.findFirst({
        where: { id: savedSearchId, resource: "leads", OR: [{ orgId }, { orgId: null }] },
      });
      if (!savedSearch) return false;
      primaryMatches = matchesSavedSearchFilters(lead, savedSearch.filters);
      break;
    }
    default:
      return false;
  }

  if (!primaryMatches) return false;

  if (Array.isArray(normalizedAudience.conditions) && normalizedAudience.conditions.length > 0) {
    return evaluateCondition({
      conditions: normalizedAudience.conditions,
      logic: normalizedAudience.logic || "AND",
    });
  }

  return true;
};

const enrollLeadInActiveCampaigns = async (lead, orgId, userId) => {
  try {
    if (!lead?.id) throw new Error("Valid lead is required for campaign enrollment.");
    if (!lead.email) return { enrolled: 0, paused: 0, campaignsChecked: 0 };
    if (!orgId) throw new Error("Organization ID is required for campaign enrollment.");

    return await reconcileLeadWithActiveCampaigns(lead.id, orgId, userId);
  } catch (error) {
    console.error("Campaign auto-enrollment error:", error);
    throw error;
  }
};

module.exports = {
  enrollLeadInActiveCampaigns,
  reconcileLeadWithActiveCampaigns,
  reconcileCampaignAudience,
  createDefaultCampaign,
  leadMatchesAudience,
  getMatchingCampaignLeads,
  getCampaignAudienceCount,
  ensureCampaignSequence,
}const getMatchingCampaignLeads = async (audience, orgId) => {
  const normalizedAudience = normalizeAudience(audience);

  const leads = await prisma.lead.findMany({
    where: { orgId, email: { not: "" } },
    include: {
      tags: {
        select: {
          tagId: true,
          tag: { select: { id: true, name: true, slug: true } },
        },
      },
    },
  });

  const matching = [];
  for (const lead of leads) {
    if (await leadMatchesAudience(lead, normalizedAudience, orgId)) {
      matching.push({
        id: lead.id,
        name: lead.name,
        email: lead.email,
        companyName: lead.companyName,
        jobTitle: lead.jobTitle,
        industry: lead.industry,
        status: lead.status,
        score: lead.score,
      });
    }
  }
  return matching;
};

const getCampaignAudienceCount = async (audience, orgId) => {
  const normalizedAudience = normalizeAudience(audience);
  if (normalizedAudience.type === "segment") {
    const leads = await getMatchingCampaignLeads(audience, orgId);
    return leads.length;
  }

  const leadWhere = await buildAudienceLeadWhere(audience, orgId);
  if (!leadWhere) return 0;
  return prisma.lead.count({ where: leadWhere });
};

const ensureCampaignSequence = async ({ campaign, orgId, userId, steps }) => {
  let sequence = await prisma.sequence.findUnique({
    where: { workflowId: campaign.id },
  });

  if (!sequence) {
    sequence = await prisma.sequence.findFirst({
      where: { orgId, name: `Campaign: ${campaign.name}` },
    });
  }

  if (sequence) {
    return prisma.sequence.update({
      where: { id: sequence.id },
      data: {
        workflowId: campaign.id,
        orgId,
        userId,
        name: `Campaign: ${campaign.name}`,
        description: campaign.description || null,
        status: "ACTIVE",
        steps,
      },
    });
  }

  return prisma.sequence.create({
    data: {
      orgId,
      userId,
      workflowId: campaign.id,
      name: `Campaign: ${campaign.name}`,
      description: campaign.description || null,
      status: "ACTIVE",
      steps,
    },
  });
};

const reconcileLeadWithActiveCampaigns = async (leadId, orgId, userId) => {
  const lead = await prisma.lead.findFirst({
    where: { id: Number(leadId), orgId },
  });

  if (!lead || !lead.email) {
    return { enrolled: 0, paused: 0, campaignsChecked: 0 };
  }

  const campaigns = await prisma.workflow.findMany({
    where: {
      orgId,
      active: true,
      trigger: "SCHEDULED_TIME",
    },
    orderBy: { id: "asc" },
  });

  let enrolled = 0;
  let paused = 0;

  for (const campaign of campaigns) {
    const conditions = campaign.conditions || {};
    if (conditions.status !== "running") continue;

    const sequence = await ensureCampaignSequence({
      campaign,
      orgId,
      userId: userId || campaign.userId,
      steps: Array.isArray(conditions.steps) ? conditions.steps : [],
    });

    const matches = await leadMatchesAudience(lead, conditions.audience, orgId);
    const existing = await prisma.sequenceEnrollment.findUnique({
      where: {
        sequenceId_leadId: { sequenceId: sequence.id, leadId: lead.id },
      },
    });

    if (matches) {
      if (!existing) {
        await prisma.sequenceEnrollment.create({
          data: {
            orgId,
            sequenceId: sequence.id,
            leadId: lead.id,
            email: lead.email,
            status: "ACTIVE",
            currentStep: 0,
            steps: sequence.steps,
            nextRunAt: new Date(),
          },
        });
        enrolled += 1;
      } else if (existing.status === "PAUSED") {
        await prisma.sequenceEnrollment.update({
          where: { id: existing.id },
          data: {
            status: "ACTIVE",
            nextRunAt: new Date(),
            email: lead.email,
          },
        });
        enrolled += 1;
      }
    } else if (existing?.status === "ACTIVE") {
      await prisma.sequenceEnrollment.update({
        where: { id: existing.id },
        data: { status: "PAUSED", nextRunAt: null },
      });
      paused += 1;
    }
  }

  return { enrolled, paused, campaignsChecked: campaigns.length };
};

const reconcileCampaignAudience = async (campaignId, orgId, userId) => {
  const campaign = await prisma.workflow.findFirst({
    where: { id: Number(campaignId), orgId },
  });

  if (!campaign || !campaign.active || campaign.conditions?.status !== "running") {
    return { enrolled: 0, paused: 0, campaignsChecked: 0 };
  }

  const conditions = campaign.conditions || {};
  const steps = Array.isArray(conditions.steps) ? conditions.steps : [];
  const sequence = await ensureCampaignSequence({
    campaign,
    orgId,
    userId: userId || campaign.userId,
    steps,
  });
  const matchingLeads = await getMatchingCampaignLeads(conditions.audience, orgId);
  const matchingIds = new Set(matchingLeads.map((lead) => lead.id));
  const enrollments = await prisma.sequenceEnrollment.findMany({
    where: { sequenceId: sequence.id, status: { in: ["ACTIVE", "PAUSED"] } },
  });

  let enrolled = 0;
  let paused = 0;

  for (const enrollment of enrollments) {
    if (enrollment.leadId && !matchingIds.has(enrollment.leadId) && enrollment.status === "ACTIVE") {
      await prisma.sequenceEnrollment.update({
        where: { id: enrollment.id },
        data: { status: "PAUSED", nextRunAt: null },
      });
      paused += 1;
    }
  }

  for (const lead of matchingLeads) {
    const existing = await prisma.sequenceEnrollment.findUnique({
      where: { sequenceId_leadId: { sequenceId: sequence.id, leadId: lead.id } },
    });

    if (!existing) {
      await prisma.sequenceEnrollment.create({
        data: {
          orgId,
          sequenceId: sequence.id,
          leadId: lead.id,
          email: lead.email,
          status: "ACTIVE",
          currentStep: 0,
          steps: sequence.steps,
          nextRunAt: new Date(),
        },
      });
      enrolled += 1;
    } else if (existing.status === "PAUSED") {
      await prisma.sequenceEnrollment.update({
        where: { id: existing.id },
        data: { status: "ACTIVE", nextRunAt: new Date(), email: lead.email },
      });
      enrolled += 1;
    }
  }

  return { enrolled, paused, campaignsChecked: 1 };
};

/**
 * Safely compare values.
 */
const valuesMatch = (leadValue, filterValue) => {
  if (
    leadValue === null ||
    leadValue === undefined ||
    filterValue === null ||
    filterValue === undefined
  ) {
    return false;
  }

  return (
    String(leadValue).trim().toLowerCase() ===
    String(filterValue).trim().toLowerCase()
  );
};

/**
 * Match one lead against a saved-search filter object.
 *
 * Supported simple filters:
 *   { field: "status", value: "new" }
 *
 *   { status: "new" }
 *
 *   { industry: "Technology" }
 *
 *   { status: ["new", "qualified"] }
 *
 * Also supports:
 *   { conditions: [...] }
 *
 * If multiple fields exist, ALL conditions must match.
 */
const getAudienceFieldValue = (lead, field) => {
  if (["tagId", "tagIds", "tags"].includes(field)) {
    const tagIds = Array.isArray(lead?.tags)
      ? lead.tags.map((entry) => Number(entry?.tagId ?? entry?.tag?.id ?? entry?.id)).filter(Number.isFinite)
      : [];
    return tagIds;
  }

  return lead?.[field];
};

const compareAudienceField = (actual, operator, expected) => {
  if (Array.isArray(actual)) {
    const values = actual;
    const normalized = String(operator || "equals").toLowerCase();

    if (normalized === "not_equals" || normalized === "neq") {
      return values.every((value) => !compareAudienceValue(value, "equals", expected));
    }

    return values.some((value) => compareAudienceValue(value, normalized, expected));
  }

  return compareAudienceValue(actual, operator, expected);
};

const matchesSavedSearchFilters = (lead, filters) => {
  if (!filters || typeof filters !== "object") return true;

  const evaluateCondition = (condition) => {
    if (!condition || typeof condition !== "object") return true;

    if (Array.isArray(condition.conditions)) {
      const logic = String(condition.logic || "AND").toUpperCase();
      const results = condition.conditions.map(evaluateCondition);
      return logic === "OR" ? results.some(Boolean) : results.every(Boolean);
    }

    if (condition.field && condition.operator) {
      return compareAudienceField(
        getAudienceFieldValue(lead, condition.field),
        condition.operator,
        condition.value
      );
    }

    if (condition.field) {
      const actual = getAudienceFieldValue(lead, condition.field);
      const expected = condition.value;
      if (Array.isArray(expected)) {
        return expected.some((value) => compareAudienceField(actual, "equals", value));
      }
      return compareAudienceField(actual, "equals", expected);
    }

    const entries = Object.entries(condition).filter(
      ([key]) => !["id", "name", "resource", "logic", "operator", "conditions"].includes(key)
    );

    return entries.every(([field, expected]) => {
      const actual = getAudienceFieldValue(lead, field);

      if (Array.isArray(expected)) {
        return expected.some((value) => compareAudienceField(actual, "equals", value));
      }

      if (expected && typeof expected === "object" && !Array.isArray(expected)) {
        if (expected.operator) {
          return compareAudienceField(actual, expected.operator, expected.value);
        }
        if (expected.value !== undefined) {
          return compareAudienceField(actual, "equals", expected.value);
        }
      }

      return compareAudienceField(actual, "equals", expected);
    });
  };

  return evaluateCondition(filters);
};

const compareAudienceValue = (actual, operator, expected) => {
  const normalized = String(operator || "equals").toLowerCase();
  if (["gt", "gte", "lt", "lte", "greater_than", "greater_or_equal", "less_than", "less_or_equal"].includes(normalized)) {
    const a = Number(actual);
    const b = Number(expected);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
    if (normalized === "gt" || normalized === "greater_than") return a > b;
    if (normalized === "gte" || normalized === "greater_or_equal") return a >= b;
    if (normalized === "lt" || normalized === "less_than") return a < b;
    return a <= b;
  }

  if (normalized === "contains") {
    return actual != null && String(actual).toLowerCase().includes(String(expected).toLowerCase());
  }
  if (normalized === "starts_with") {
    return actual != null && String(actual).toLowerCase().startsWith(String(expected).toLowerCase());
  }
  if (normalized === "ends_with") {
    return actual != null && String(actual).toLowerCase().endsWith(String(expected).toLowerCase());
  }
  if (normalized === "not_equals" || normalized === "neq") {
    return !valuesMatch(actual, expected);
  }
  return valuesMatch(actual, expected);
};

/**
 * Check whether a lead matches a campaign audience.
 */
const leadMatchesAudience = async (lead, audience, orgId) => {
  const normalizedAudience = normalizeAudience(audience);

  switch (normalizedAudience.type) {
    /**
     * ALL LEADS
     */
    case "all":
      return true;

    /**
     * BY STATUS
     */
    case "status":
      if (!normalizedAudience.status) {
        return false;
      }

      return valuesMatch(
        lead.status,
        normalizedAudience.status
      );

    /**
     * BY SCORE
     */
    case "score": {
      const min = normalizedAudience.min !== undefined && normalizedAudience.min !== "" ? Number(normalizedAudience.min) : null;
      const max = normalizedAudience.max !== undefined && normalizedAudience.max !== "" ? Number(normalizedAudience.max) : null;
      if (min === null && max === null) return false;
      if (min !== null && !Number.isFinite(min)) return false;
      if (max !== null && !Number.isFinite(max)) return false;
      if (min !== null && max !== null && min > max) return false;
      if (min !== null && lead.score < min) return false;
      if (max !== null && lead.score > max) return false;
      return true;
    }

    /**
     * BY TAG
     */
    case "tag": {
      const tagId = Number(normalizedAudience.tagId);

      if (!Number.isInteger(tagId) || tagId <= 0) {
        return false;
      }

      const leadTag = await prisma.leadTag.findFirst({
        where: {
          leadId: lead.id,
          tagId,
        },
      });

      return Boolean(leadTag);
    }

    /**
     * BY SAVED SEGMENT
     */
    case "segment": {
      const savedSearchId = Number(
        normalizedAudience.savedSearchId
      );

      if (
        !Number.isInteger(savedSearchId) ||
        savedSearchId <= 0
      ) {
        return false;
      }

      const savedSearch = await prisma.savedSearch.findFirst({
        where: {
          id: savedSearchId,
          resource: "leads",
          OR: [
            { orgId },
            { orgId: null },
          ],
        },
      });

      if (!savedSearch) {
        return false;
      }

      const leadForSegment =
        Array.isArray(lead.tags)
          ? lead
          : {
              ...lead,
              tags: await prisma.leadTag.findMany({
                where: { leadId: lead.id },
                select: { tagId: true },
              }),
            };

      return matchesSavedSearchFilters(
        leadForSegment,
        savedSearch.filters
      );
    }

    default:
      return false;
  }
};

const enrollLeadInActiveCampaigns = async (lead, orgId, userId) => {
  try {
    if (!lead?.id) throw new Error("Valid lead is required for campaign enrollment.");
    if (!lead.email) return { enrolled: 0, paused: 0, campaignsChecked: 0 };
    if (!orgId) throw new Error("Organization ID is required for campaign enrollment.");

    return await reconcileLeadWithActiveCampaigns(lead.id, orgId, userId);
  } catch (error) {
    console.error("Campaign auto-enrollment error:", error);
    throw error;
  }
};

module.exports = {
  enrollLeadInActiveCampaigns,
  reconcileLeadWithActiveCampaigns,
  reconcileCampaignAudience,
  createDefaultCampaign,
  leadMatchesAudience,
  getMatchingCampaignLeads,
  getCampaignAudienceCount,
  ensureCampaignSequence,
};