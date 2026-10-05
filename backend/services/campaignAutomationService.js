const { prisma } = require("../config/postgres");
const { activateCampaign } = require("../controllers/campaignController");
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
const matchesSavedSearchFilters = (lead, filters) => {
  if (!filters || typeof filters !== "object") {
    return true;
  }

  // Some saved searches may store filters inside "conditions"
  if (Array.isArray(filters.conditions)) {
    return filters.conditions.every((condition) =>
      matchesSavedSearchFilters(lead, condition)
    );
  }

  // Common operator format:
  // { field: "status", operator: "equals", value: "new" }
  if (filters.field && filters.operator) {
    const actual = lead[filters.field];
    const expected = filters.value;

    switch (filters.operator) {
      case "equals":
      case "eq":
        return valuesMatch(actual, expected);

      case "not_equals":
      case "neq":
        return !valuesMatch(actual, expected);

      case "contains":
        if (actual === null || actual === undefined) return false;

        return String(actual)
          .toLowerCase()
          .includes(String(expected).toLowerCase());

      case "starts_with":
        if (actual === null || actual === undefined) return false;

        return String(actual)
          .toLowerCase()
          .startsWith(String(expected).toLowerCase());

      case "ends_with":
        if (actual === null || actual === undefined) return false;

        return String(actual)
          .toLowerCase()
          .endsWith(String(expected).toLowerCase());

      default:
        return valuesMatch(actual, expected);
    }
  }

  // Single field/value format
  if (filters.field) {
    const field = filters.field;
    const expected = filters.value;
    const actual = lead[field];

    if (Array.isArray(expected)) {
      return expected.some((value) => valuesMatch(actual, value));
    }

    return valuesMatch(actual, expected);
  }

  // Direct object:
  // { status: "new", industry: "Technology" }
  //
  // Every defined field must match.
  const ignoredKeys = [
    "id",
    "name",
    "resource",
    "logic",
    "operator",
    "conditions",
  ];

  const entries = Object.entries(filters).filter(
    ([key]) => !ignoredKeys.includes(key)
  );

  if (entries.length === 0) {
    return true;
  }

  return entries.every(([field, expected]) => {
    const actual = lead[field];

    if (Array.isArray(expected)) {
      return expected.some((value) => valuesMatch(actual, value));
    }

    if (
      expected &&
      typeof expected === "object" &&
      !Array.isArray(expected)
    ) {
      if (expected.operator) {
        return matchesSavedSearchFilters(lead, {
          field,
          operator: expected.operator,
          value: expected.value,
        });
      }

      if (expected.value !== undefined) {
        return valuesMatch(actual, expected.value);
      }
    }

    return valuesMatch(actual, expected);
  });
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

      return matchesSavedSearchFilters(
        lead,
        savedSearch.filters
      );
    }

    default:
      return false;
  }
};

const enrollLeadInActiveCampaigns = async (
  lead,
  orgId,
  userId
) => {
  try {
    if (!lead || !lead.id) {
      throw new Error(
        "Valid lead is required for campaign enrollment."
      );
    }

    if (!lead.email) {
      throw new Error(
        "Lead email is required for campaign enrollment."
      );
    }

    if (!orgId) {
      throw new Error(
        "Organization ID is required for campaign enrollment."
      );
    }

    if (!userId) {
      throw new Error(
        "User ID is required for campaign enrollment."
      );
    }

     // --- NEW: retry campaigns that were auto-paused because they had no
    // matching leads yet. Now that a new lead just arrived, try activating them.
    let autoPausedCampaigns = await prisma.workflow.findMany({
      where: { orgId, trigger: "SCHEDULED_TIME", active: false },
    });
    autoPausedCampaigns = autoPausedCampaigns.filter(
      (c) => (c.conditions || {}).autoPaused === true
    );

    for (const c of autoPausedCampaigns) {
      const audience = normalizeAudience((c.conditions || {}).audience);
      const matches = await leadMatchesAudience(lead, audience, orgId);
      if (!matches) continue;

      try {
        await activateCampaign({
          campaign: c,
          orgId,
          userId,
          allowPastSchedule: true,
        });
        console.log(`Auto-resumed campaign ${c.id} ("${c.name}") after a new matching lead arrived.`);
      } catch (err) {
        console.warn(`Retry-activation still failing for campaign ${c.id}:`, err.message);
      }
    }
    // --- end new block ---

    let campaigns = await prisma.workflow.findMany({
      where: {
        orgId,
        active: true,
        trigger: "SCHEDULED_TIME",
      },
      orderBy: {
        id: "asc",
      },
    });

    /**
     * Only campaigns which are marked as running
     * should receive new leads.
     */
    campaigns = campaigns.filter((campaign) => {
      const conditions = campaign.conditions || {};

      return conditions.status === "running";
    });

    /**
     * If no campaign is currently running, do not create a new campaign.
     * New leads should only be enrolled into campaigns that were already
     * launched and are still running.
     */
    if (campaigns.length === 0) {
      return {
        enrolled: 0,
        skipped: 0,
        campaignsChecked: 0,
      };
    }

    let enrolled = 0;
    let skipped = 0;

    for (const campaign of campaigns) {
      const conditions = campaign.conditions || {};

      const audience = normalizeAudience(
        conditions.audience
      );

      /**
       * STEP 3:
       * Check whether this lead belongs to the
       * campaign's target audience.
       */
      const matches = await leadMatchesAudience(
        lead,
        audience,
        orgId
      );

      if (!matches) {
        skipped++;
        continue;
      }

      /**
       * Get campaign sequence.
       */
      let sequence = await prisma.sequence.findUnique({
        where: {
          workflowId: campaign.id,
        },
      });

      // Backward compatibility for sequences created before workflowId existed.
      if (!sequence) {
        sequence = await prisma.sequence.findFirst({
          where: {
            orgId,
            name: `Campaign: ${campaign.name}`,
          },
        });

        if (sequence) {
          sequence = await prisma.sequence.update({
            where: { id: sequence.id },
            data: { workflowId: campaign.id, orgId },
          });
        }
      }

      if (!sequence) {
        console.warn(`Campaign ${campaign.id} has no associated sequence.`);
        skipped++;
        continue;
      }

      /**
       * Prevent duplicate enrollment.
       */
      const existingEnrollment =
        await prisma.sequenceEnrollment.findUnique({
          where: {
            sequenceId_leadId: {
              sequenceId: sequence.id,
              leadId: lead.id,
            },
          },
        });

      if (existingEnrollment) {
        skipped++;
        continue;
      }

      try {
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

        enrolled++;
      } catch (error) {
        /**
         * Another request may have enrolled the same
         * lead at the same time.
         */
        if (error.code === "P2002") {
          skipped++;
          continue;
        }

        throw error;
      }
    }

    return {
      enrolled,
      skipped,
      campaignsChecked: campaigns.length,
    };
  } catch (error) {
    console.error(
      "Campaign auto-enrollment error:",
      error
    );

    throw error;
  }
};

module.exports = {
  enrollLeadInActiveCampaigns,
  createDefaultCampaign,
  leadMatchesAudience,
};