// Campaign management - marketing automation and email campaigns.
const { prisma } = require("../config/postgres");
const { AppError } = require("../middleware/errorHandler");
const asyncHandler = require("../utils/asyncHandler");
const response = require("../utils/response");
const { recordAudit } = require("../services/auditService");
const { invalidateCache } = require("../utils/cache");
const {
  getMatchingCampaignLeads,
  getCampaignAudienceCount,
  ensureCampaignSequence,
  reconcileCampaignAudience,
} = require("../services/campaignAutomationService");

// Campaigns are stored using the existing Workflow model with JSON metadata.
// This provides full campaign management without new schema.

const CAMPAIGN_STATUSES = ["draft", "scheduled", "running", "paused", "completed", "cancelled"];
const CAMPAIGN_TYPES = ["email", "sms", "social", "webhook", "multi_channel"];

const list = asyncHandler(async (req, res) => {
  const { page = 1, limit = 50, status, type } = req.query;
  const where = { orgId: req.orgId };
  // Workflow model has 'active' (Boolean), not 'status' (String)
  if (status) where.active = (status === "running");
  const skip = (Number(page) - 1) * Number(limit);
  const [items, total] = await Promise.all([
    prisma.workflow.findMany({ where, orderBy: { createdAt: "desc" }, skip, take: Number(limit) }),
    prisma.workflow.count({ where }),
  ]);

  // Expected audience size is always calculated from the latest campaign
  // conditions, so the pre-launch UI never shows a stale recipient count.
  const enrichedItems = await Promise.all(
    items.map(async (campaign) => ({
      ...campaign,
      expectedLeads: await getCampaignAudienceCount(
        campaign.conditions?.audience,
        req.orgId
      ),
    }))
  );

  return response.paginated(res, enrichedItems, total, page, limit);
});

const get = asyncHandler(async (req, res) => {
  const campaign = await prisma.workflow.findFirst({ where: { id: Number(req.params.id), orgId: req.orgId } });
  if (!campaign) throw new AppError("Campaign not found.", 404);
  return response.success(res, campaign);
});

const create = asyncHandler(async (req, res) => {
  const {
  name,
  description,
  subject,
  body,
  audience,
  steps,
  type = "email",
  status = "draft",
  segment,
  content,
  schedule,
  budget,
} = req.body;
  if (!name) throw new AppError("name is required.", 400);
  // WorkflowTrigger enum: use "SCHEDULED_TIME" as the default campaign trigger.
  // Store the campaign type inside the conditions JSON object.
  const campaign = await prisma.workflow.create({
    data: {
      orgId: req.orgId,
      userId: req.user.id,
      name, description: description || null,
      trigger: "SCHEDULED_TIME",
      conditions: {
  segment: segment || null,
  subject: subject || steps?.[0]?.subject || "",
  body: body || steps?.[0]?.body || "",
  audience: audience || "all",
  steps: steps || [
    {
      day: 0,
      subject: subject || "",
      body: body || "",
    },
  ],
  type,
  schedule: schedule || null,
  status: schedule ? "scheduled" : "draft",
  budget: budget || null,
},
      actions: content || [{ type: "SEND_EMAIL" }],
      // A scheduled campaign must stay inactive until the scheduler reaches
      // the latest conditions.schedule value. Never create enrollment early.
      active: false,
    },
  });
  await recordAudit({ userId: req.user.id, orgId: req.orgId, action: "campaign.create", entityType: "Campaign", entityId: campaign.id, metadata: { name, type, status } });
  invalidateCache("/campaigns");
  return response.created(res, campaign);
});

const update = asyncHandler(async (req, res) => {
  const {
    name,
    description,
    subject,
    body,
    audience,
    steps,
    status,
    segment,
    content,
    budget,
    schedule,
  } = req.body;

  const campaign = await prisma.workflow.findFirst({
    where: { id: Number(req.params.id), orgId: req.orgId },
  });
  if (!campaign) throw new AppError("Campaign not found.", 404);

  const currentConditions =
    typeof campaign.conditions === "object" && campaign.conditions
      ? campaign.conditions
      : {};
  const nextConditions = { ...currentConditions };
  const audienceChanged = audience !== undefined;
  let scheduleChanged = false;

  if (name !== undefined) campaign.name = name;
  const data = {};
  if (name !== undefined) data.name = name;
  if (description !== undefined) data.description = description;
  if (content !== undefined) data.actions = content;

  if (segment !== undefined) nextConditions.segment = segment;
  if (budget !== undefined) nextConditions.budget = budget;
  if (subject !== undefined) nextConditions.subject = subject;
  if (body !== undefined) nextConditions.body = body;
  if (steps !== undefined) nextConditions.steps = steps;
  if (audience !== undefined) nextConditions.audience = audience;

  if (schedule !== undefined) {
    const scheduledAt = schedule ? new Date(schedule) : null;
    if (schedule && (!scheduledAt || Number.isNaN(scheduledAt.getTime()))) {
      throw new AppError("A valid campaign schedule date and time is required.", 400);
    }
    nextConditions.schedule = scheduledAt ? scheduledAt.toISOString() : null;
    scheduleChanged = true;
  }

  const wasRunning = campaign.active && currentConditions.status === "running";
  const nextSchedule = nextConditions.schedule ? new Date(nextConditions.schedule) : null;

  // Editing a scheduled campaign must never activate it early. The latest
  // schedule remains the source of truth for the scheduler.
  if (!wasRunning && scheduleChanged) {
    data.active = false;
    nextConditions.status = nextSchedule ? "scheduled" : "draft";
    delete nextConditions.autoPaused;
    delete nextConditions.lastError;
  } else if (status !== undefined && wasRunning) {
    data.active = status === "running";
    nextConditions.status = status;
  } else if (status !== undefined && !scheduleChanged) {
    data.active = status === "running";
    nextConditions.status = status;
  }

  if (
    audienceChanged ||
    segment !== undefined ||
    budget !== undefined ||
    subject !== undefined ||
    body !== undefined ||
    steps !== undefined ||
    scheduleChanged ||
    status !== undefined
  ) {
    data.conditions = nextConditions;
  }

  await prisma.workflow.update({ where: { id: campaign.id }, data });

  if (audienceChanged && wasRunning) {
    await reconcileCampaignAudience(campaign.id, req.orgId, req.user.id);
  }

  invalidateCache("/campaigns");
  return response.success(res, { message: "Campaign updated." });
});

const remove = asyncHandler(async (req, res) => {
  const result = await prisma.workflow.deleteMany({ where: { id: Number(req.params.id), orgId: req.orgId } });
  if (result.count === 0) throw new AppError("Campaign not found.", 404);
  invalidateCache("/campaigns");
  return response.success(res, { message: "Campaign deleted." });
});

const activateCampaign = async ({
  campaign,
  orgId,
  userId,
  allowPastSchedule = false,
}) => {
  if (!campaign) throw new AppError("Campaign not found.", 404);

  // Re-read the workflow immediately before activation. This makes the
  // database's latest conditions.schedule and audience the source of truth,
  // even when the scheduler picked up an older snapshot.
  const latestCampaign = await prisma.workflow.findFirst({
    where: { id: campaign.id, orgId },
  });
  if (!latestCampaign) throw new AppError("Campaign not found.", 404);

  const conditions =
    typeof latestCampaign.conditions === "object" && latestCampaign.conditions
      ? latestCampaign.conditions
      : {};

  if (conditions.status === "running" && latestCampaign.active) {
    return {
      alreadyRunning: true,
      scheduledAt: conditions.schedule || null,
      enrolled: 0,
    };
  }

  const subject = conditions.subject || "";
  const body = conditions.body || "";
  const scheduledAt = conditions.schedule ? new Date(conditions.schedule) : null;

  if (!scheduledAt || Number.isNaN(scheduledAt.getTime())) {
    throw new AppError("A valid campaign schedule date and time is required.", 400);
  }

  if (!allowPastSchedule && scheduledAt.getTime() < Date.now()) {
    throw new AppError("Campaign schedule must be in the future.", 400);
  }

  const campaignSteps = Array.isArray(conditions.steps)
    ? conditions.steps
    : [{ day: 0, subject, body }];

  if (!subject) throw new AppError("Campaign subject is required.", 400);
  if (!body) throw new AppError("Campaign email body is required.", 400);

  // Sequence creation happens only at activation time. A scheduled campaign
  // therefore has no SequenceEnrollment records before its start time.
  const sequence = await ensureCampaignSequence({
    campaign: latestCampaign,
    orgId,
    userId: userId || latestCampaign.userId,
    steps: campaignSteps,
  });

  // Read the audience after reading the latest workflow, so audience edits made
  // before the scheduled time are applied to the real enrollment set.
  const leads = await getMatchingCampaignLeads(conditions.audience, orgId);

  for (const lead of leads) {
    const existingEnrollment = await prisma.sequenceEnrollment.findUnique({
      where: { sequenceId_leadId: { sequenceId: sequence.id, leadId: lead.id } },
    });

    if (existingEnrollment) {
      // Completed/replied/bounced/stopped history is never deleted or rewritten.
      if (existingEnrollment.status === "PAUSED") {
        await prisma.sequenceEnrollment.update({
          where: { id: existingEnrollment.id },
          data: { status: "ACTIVE", nextRunAt: scheduledAt, email: lead.email },
        });
      }
      continue;
    }

    await prisma.sequenceEnrollment.create({
      data: {
        orgId,
        sequenceId: sequence.id,
        leadId: lead.id,
        email: lead.email,
        status: "ACTIVE",
        currentStep: 0,
        steps: campaignSteps,
        startedAt: scheduledAt,
        nextRunAt: scheduledAt,
      },
    });
  }

  await prisma.workflow.update({
    where: { id: latestCampaign.id },
    data: {
      active: true,
      conditions: {
        ...conditions,
        status: "running",
        schedule: scheduledAt.toISOString(),
        autoPaused: false,
        lastError: null,
      },
    },
  });

  invalidateCache("/campaigns");

  return {
    alreadyRunning: false,
    scheduledAt: scheduledAt.toISOString(),
    enrolled: leads.length,
  };
};

const launch = asyncHandler(async (req, res) => {
  const campaign = await prisma.workflow.findFirst({
    where: { id: Number(req.params.id), orgId: req.orgId },
  });
  if (!campaign) throw new AppError("Campaign not found.", 404);

  const conditions =
    typeof campaign.conditions === "object" && campaign.conditions
      ? campaign.conditions
      : {};
  const scheduledAt = conditions.schedule ? new Date(conditions.schedule) : null;

  if (!scheduledAt || Number.isNaN(scheduledAt.getTime())) {
    throw new AppError("A valid campaign schedule date and time is required.", 400);
  }
  if (scheduledAt.getTime() < Date.now()) {
    throw new AppError("Campaign schedule must be in the future.", 400);
  }

  await prisma.workflow.update({
    where: { id: campaign.id },
    data: {
      active: false,
      conditions: {
        ...conditions,
        status: "scheduled",
        autoPaused: false,
        lastError: null,
      },
    },
  });

  invalidateCache("/campaigns");

  return response.success(res, {
    message: "Campaign scheduled.",
    scheduledAt: scheduledAt.toISOString(),
    enrolled: 0,
  });
});

const pause = asyncHandler(async (req, res) => {
  const campaign = await prisma.workflow.findFirst({
    where: {
      id: Number(req.params.id),
      orgId: req.orgId,
    },
  });

  if (!campaign) {
    throw new AppError("Campaign not found.", 404);
  }

  const sequence = await prisma.sequence.findFirst({
    where: {
      orgId: req.orgId,
      name: `Campaign: ${campaign.name}`,
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  await prisma.workflow.update({
    where: {
      id: campaign.id,
    },
    data: {
  active: false,
  conditions: {
    ...(typeof campaign.conditions === "object" && campaign.conditions
      ? campaign.conditions
      : {}),
    status: "paused",
  },
},
  });

  if (sequence) {
    await prisma.sequenceEnrollment.updateMany({
      where: {
        sequenceId: sequence.id,
        status: "ACTIVE",
      },
      data: {
        status: "PAUSED",
      },
    });

    await prisma.sequence.update({
      where: {
        id: sequence.id,
      },
      data: {
        status: "PAUSED",
      },
    });
  }

  invalidateCache("/campaigns");

  return response.success(res, {
    message: "Campaign paused.",
  });
});

const resume = asyncHandler(async (req, res) => {
  const campaign = await prisma.workflow.findFirst({
    where: {
      id: Number(req.params.id),
      orgId: req.orgId,
    },
  });

  if (!campaign) {
    throw new AppError("Campaign not found.", 404);
  }

  const sequence = await prisma.sequence.findFirst({
    where: {
      orgId: req.orgId,
      name: `Campaign: ${campaign.name}`,
    },
    orderBy: {
      createdAt: "desc",
    },
  });

 await prisma.workflow.update({
  where: {
    id: campaign.id,
  },
  data: {
    active: true,
    conditions: {
      ...(typeof campaign.conditions === "object" && campaign.conditions
        ? campaign.conditions
        : {}),
      status: "running",
    },
  },
});

  if (sequence) {
    await prisma.sequenceEnrollment.updateMany({
      where: {
        sequenceId: sequence.id,
        status: "PAUSED",
      },
      data: {
        status: "ACTIVE",
      },
    });

    await prisma.sequence.update({
      where: {
        id: sequence.id,
      },
      data: {
        status: "ACTIVE",
      },
    });
  }

  invalidateCache("/campaigns");

  return response.success(res, {
    message: "Campaign resumed.",
  });
});

const stop = asyncHandler(async (req, res) => {
  const campaign = await prisma.workflow.findFirst({
    where: {
      id: Number(req.params.id),
      orgId: req.orgId,
    },
  });

  if (!campaign) {
    throw new AppError("Campaign not found.", 404);
  }

  const sequence = await prisma.sequence.findFirst({
    where: {
      orgId: req.orgId,
      name: `Campaign: ${campaign.name}`,
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  await prisma.workflow.update({
    where: {
      id: campaign.id,
    },
    data: {
      active: false,
      conditions: {
        ...(typeof campaign.conditions === "object" && campaign.conditions
          ? campaign.conditions
          : {}),
        status: "cancelled",
      },
    },
  });

  if (sequence) {
    await prisma.sequenceEnrollment.updateMany({
      where: {
        sequenceId: sequence.id,
        status: {
          in: ["ACTIVE", "PAUSED"],
        },
      },
      data: {
        status: "STOPPED",
      },
    });

    await prisma.sequence.update({
      where: {
        id: sequence.id,
      },
      data: {
        status: "ARCHIVED",
      },
    });
  }

  invalidateCache("/campaigns");

  return response.success(res, {
    message: "Campaign stopped.",
  });
});

const metrics = asyncHandler(async (req, res) => {
  const campaigns = await prisma.workflow.findMany({
    where: { orgId: req.orgId },
    select: {
      id: true,
      active: true,
      conditions: true,
      runCount: true,
      lastRunAt: true,
      trigger: true,
    },
  });

  let running = 0;
  let paused = 0;
  let totalRuns = 0;

  for (const c of campaigns) {
    const status =
      typeof c.conditions === "object" && c.conditions
        ? c.conditions.status
        : null;

    if (status === "running") running++;
    if (status === "paused") paused++;

    totalRuns += c.runCount || 0;
  }

  return response.success(res, {
    total: campaigns.length,
    running,
    paused,
    totalRuns,
  });
});

const getEnrolledLeads = asyncHandler(async (req, res) => {
  const campaign = await prisma.workflow.findFirst({
    where: { id: Number(req.params.id), orgId: req.orgId },
  });
  if (!campaign) throw new AppError("Campaign not found.", 404);

  const sequence = await prisma.sequence.findFirst({
    where: {
      OR: [
        { workflowId: campaign.id },
        { orgId: req.orgId, name: `Campaign: ${campaign.name}` },
      ],
    },
  });

  if (!sequence) {
    return response.success(res, { campaignName: campaign.name, leads: [] });
  }

  const enrollments = await prisma.sequenceEnrollment.findMany({
    where: { sequenceId: sequence.id },
    orderBy: { createdAt: "desc" },
  });

  const leadIds = enrollments.map((e) => e.leadId).filter(Boolean);
  const leads = leadIds.length
    ? await prisma.lead.findMany({
        where: { id: { in: leadIds } },
        select: { id: true, name: true, email: true, status: true, companyName: true },
      })
    : [];
  const leadById = new Map(leads.map((l) => [l.id, l]));

  const result = enrollments.map((enrollment) => {
    const lead = enrollment.leadId ? leadById.get(enrollment.leadId) : null;
    return {
      enrollmentId: enrollment.id,
      leadId: enrollment.leadId,
      name: lead?.name || null,
      email: enrollment.email,
      companyName: lead?.companyName || null,
      leadStatus: lead?.status || null,
      enrollmentStatus: enrollment.status,
      currentStep: enrollment.currentStep,
      totalSteps: Array.isArray(enrollment.steps) ? enrollment.steps.length : 0,
      startedAt: enrollment.startedAt,
      completedAt: enrollment.completedAt,
    };
  });

  return response.success(res, { campaignName: campaign.name, leads: result });
});

module.exports = {
  activateCampaign,
  list,
  get,
  create,
  update,
  remove,
  launch,
  pause,
  resume,
  stop,
  metrics,
  getEnrolledLeads,
  CAMPAIGN_STATUSES,
  CAMPAIGN_TYPES
};
