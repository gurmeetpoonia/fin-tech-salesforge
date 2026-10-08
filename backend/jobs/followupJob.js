// Background jobs. All time-based work runs in a single scheduler with safety guards
// so a slow iteration never overlaps the next one.
const cron = require("node-cron");
const { prisma } = require("../config/postgres");
const { AppError } = require("../middleware/errorHandler");
const { sendCampaignEmail } = require("../services/emailService");
const { createInAppNotification } = require("../services/notificationService");
const { recordAudit } = require("../services/auditService");
const logger = require("../utils/logger");
const { activateCampaign } = require("../controllers/campaignController");
const { leadMatchesAudience } = require("../services/campaignAutomationService");

const isPermanentCampaignConfigurationError = (error) =>
  Number.isInteger(error?.statusCode) &&
  error.statusCode >= 400 &&
  error.statusCode < 500;

let running = false;
let schedulerInterval = null;

const tasks = {
  // Every minute: nudge new leads that haven't been contacted.
  async followupNewLeads() {
    const leads = await prisma.lead.findMany({
      where: { status: "new", followupSent: false, createdAt: { lt: new Date(Date.now() - 60_000) } },
      take: 50,
      include: { addedBy: true },
    });
    for (const lead of leads) {
      try {
        await createInAppNotification({
          userId: lead.addedById,
          orgId: lead.orgId,
          type: "LEAD_FOLLOWUP",
          category: "lead",
          message: `Don't forget to follow up with ${lead.name}.`,
          link: `/app/leads/${lead.id}`,
          metadata: { leadId: lead.id },
        });
        await prisma.lead.update({ where: { id: lead.id }, data: { followupSent: true } });
      } catch (e) {
        logger.error("job.followup.error", { leadId: lead.id, err: e.message });
      }
    }
    if (leads.length) logger.info("job.followup", { count: leads.length });
  },

  async processSequenceEnrollments() {
    const BATCH_SIZE = Math.max(1, Number(process.env.CAMPAIGN_EMAIL_BATCH_SIZE || 100));
    let totalProcessed = 0;

    // Recover enrollments stranded by a crash/restart between the claim step
    // and the final update.
    const stranded = await prisma.sequenceEnrollment.updateMany({
      where: {
        status: "ACTIVE",
        nextRunAt: null,
        updatedAt: { lt: new Date(Date.now() - 5 * 60 * 1000) },
      },
      data: { nextRunAt: new Date() },
    });
    if (stranded.count) {
      logger.warn("job.sequence.recovered_stranded", { count: stranded.count });
    }

    // Process due enrollments in batches until the queue is empty.
    while (true) {
      const now = new Date();

      const enrollments = await prisma.sequenceEnrollment.findMany({
        where: {
          status: "ACTIVE",
          nextRunAt: { lte: now },
        },
        orderBy: { id: "asc" },
        take: BATCH_SIZE,
        include: {
          sequence: {
            select: {
              orgId: true,
              workflowId: true,
              workflow: {
                select: {
                  id: true,
                  active: true,
                  trigger: true,
                  conditions: true,
                  name: true,
                  description: true,
                },
              },
            },
          },
          lead: {
            select: {
              id: true,
              name: true,
              email: true,
              status: true,
              source: true,
              assignedToId: true,
              companyName: true,
              jobTitle: true,
              industry: true,
              location: true,
              score: true,
              tags: {
                select: {
                  tagId: true,
                },
              },
            },
          },
        },
      });

      if (enrollments.length === 0) break;

      for (const enrollment of enrollments) {
        try {
          const claimed = await prisma.sequenceEnrollment.updateMany({
            where: {
              id: enrollment.id,
              status: "ACTIVE",
              nextRunAt: {
                lte: now,
              },
            },
            data: {
              nextRunAt: null,
            },
          });

          if (claimed.count !== 1) {
            continue;
          }

          // Live re-check of audience conditions before sending
          const campaign = enrollment.sequence.workflow;
          if (
            !campaign ||
            !campaign.active ||
            campaign.trigger !== "SCHEDULED_TIME" ||
            campaign.conditions?.status !== "running" ||
            !enrollment.leadId ||
            !(await leadMatchesAudience(
              enrollment.lead,
              campaign.conditions?.audience,
              enrollment.sequence.orgId
            ))
          ) {
            await prisma.sequenceEnrollment.update({
              where: { id: enrollment.id },
              data: { status: "PAUSED", nextRunAt: null },
            });
            continue;
          }

          const stopEvent = await prisma.emailEvent.findFirst({
            where: {
              orgId: enrollment.sequence.orgId,
              recipient: enrollment.email,
              type: { in: ["BOUNCED", "REPLIED"] },
            },
            orderBy: { createdAt: "desc" },
          });

          if (stopEvent) {
            const stopStatus = stopEvent.type === "BOUNCED" ? "BOUNCED" : "REPLIED";

            await prisma.sequenceEnrollment.update({
              where: { id: enrollment.id },
              data: {
                status: stopStatus,
                nextRunAt: null,
              },
            });

            logger.info("job.sequence.stopped", {
              enrollmentId: enrollment.id,
              email: enrollment.email,
              reason: stopEvent.type,
            });

            continue;
          }

          const steps = enrollment.steps;
          if (!Array.isArray(steps) || steps.length === 0) {
            await prisma.sequenceEnrollment.update({
              where: { id: enrollment.id },
              data: { status: "COMPLETED" },
            });
            continue;
          }

          const currentStep = steps[enrollment.currentStep];
          if (!currentStep) {
            await prisma.sequenceEnrollment.update({
              where: { id: enrollment.id },
              data: { status: "COMPLETED" },
            });
            continue;
          }

          logger.info("job.sequence.email_sending", {
            enrollmentId: enrollment.id,
            email: enrollment.email,
            step: enrollment.currentStep,
          });

          // Call the Gemini-powered sender
          const sent = await sendCampaignEmail({
            lead: enrollment.lead,
            campaign,
            enrollment,
          });

          if (!sent) {
            logger.warn("job.sequence.email_failed_or_skipped", {
              enrollmentId: enrollment.id,
              email: enrollment.email,
              step: enrollment.currentStep,
            });

            const retryMinutes = Math.max(1, Number(process.env.CAMPAIGN_AI_RETRY_MINUTES || 3));
            await prisma.sequenceEnrollment.updateMany({
              where: { id: enrollment.id, status: "ACTIVE" },
              data: { nextRunAt: new Date(Date.now() + retryMinutes * 60 * 1000) },
            });

            continue;
          }

          // Record sent event
          await prisma.emailEvent.create({
            data: {
              orgId: enrollment.sequence.orgId,
              type: "SENT",
              recipient: enrollment.email,
              subject: campaign.name || "Campaign Email",
              messageId: `${Date.now()}-${enrollment.id}`,
            },
          });

          // Calculate next step
          const nextStepIndex = enrollment.currentStep + 1;
          const nextStep = steps[nextStepIndex];

          if (!nextStep) {
            await prisma.sequenceEnrollment.update({
              where: { id: enrollment.id },
              data: {
                status: "COMPLETED",
                currentStep: nextStepIndex,
                nextRunAt: null,
                completedAt: new Date(),
              },
            });
          } else {
            const nextRunAt = new Date(
              enrollment.startedAt.getTime() +
                nextStep.day * 24 * 60 * 60 * 1000
            );

            if (nextStep.time) {
              const [hours, minutes] = String(nextStep.time)
                .split(":")
                .map(Number);

              if (
                Number.isInteger(hours) &&
                Number.isInteger(minutes) &&
                hours >= 0 &&
                hours <= 23 &&
                minutes >= 0 &&
                minutes <= 59
              ) {
                nextRunAt.setHours(hours, minutes, 0, 0);
              }
            }

            await prisma.sequenceEnrollment.update({
              where: { id: enrollment.id },
              data: {
                currentStep: nextStepIndex,
                nextRunAt,
              },
            });
          }

          logger.info("job.sequence.email_sent", {
            enrollmentId: enrollment.id,
            email: enrollment.email,
            step: enrollment.currentStep,
          });
        } catch (e) {
          logger.error("job.sequence.error", {
            enrollmentId: enrollment.id,
            err: e.message,
          });

          try {
            await prisma.sequenceEnrollment.updateMany({
              where: { id: enrollment.id, status: "ACTIVE", nextRunAt: null },
              data: { nextRunAt: new Date(Date.now() + 5 * 60 * 1000) },
            });
          } catch (releaseErr) {
            logger.error("job.sequence.release_failed", {
              enrollmentId: enrollment.id,
              err: releaseErr.message,
            });
          }
        }
      }

      totalProcessed += enrollments.length;
      logger.info("job.sequence.batch", {
        count: enrollments.length,
        totalProcessed,
      });
    }

    if (totalProcessed) {
      logger.info("job.sequence", { count: totalProcessed });
    }
  },

  // Daily at 02:00: log a snapshot of platform metrics.
  async dailySnapshot() {
    const [users, orgs, leads, deals, activeSubs] = await Promise.all([
      prisma.user.count(),
      prisma.organization.count(),
      prisma.lead.count(),
      prisma.deal.count(),
      prisma.organization.count({ where: { plan: { in: ["STARTER", "PRO", "ENTERPRISE"] } } }),
    ]);
    await recordAudit({
      action: "system.daily_snapshot",
      entityType: "System",
      metadata: { users, orgs, leads, deals, activeSubs, date: new Date().toISOString() },
    });
    logger.info("job.snapshot", { users, orgs, leads, deals, activeSubs });
  },
};

const activateDueCampaigns = async () => {
  const now = new Date();

  const campaigns = await prisma.workflow.findMany({
    where: {
      active: false,
      trigger: "SCHEDULED_TIME",
    },
    orderBy: {
      id: "asc",
    },
  });

  for (const campaign of campaigns) {
    try {
      const conditions =
        campaign.conditions &&
        typeof campaign.conditions === "object"
          ? campaign.conditions
          : {};

      if (
        conditions.status === "running" ||
        conditions.status === "completed" ||
        conditions.status === "cancelled" ||
        conditions.status === "paused" ||
        conditions.status === "error"
      ) {
        continue;
      }

      if (!conditions.schedule) {
        if (conditions.status === "scheduled") {
          throw new AppError(
            "A valid campaign schedule date and time is required.",
            400
          );
        }
        continue;
      }

      const scheduledAt = new Date(conditions.schedule);

      if (Number.isNaN(scheduledAt.getTime())) {
        throw new AppError(
          "A valid campaign schedule date and time is required.",
          400
        );
      }

      if (scheduledAt.getTime() > now.getTime()) {
        continue;
      }

      const result = await activateCampaign({
        campaign,
        orgId: campaign.orgId,
        userId: campaign.userId,
        allowPastSchedule: true,
      });

      logger.info("job.campaign.auto_activated", {
        campaignId: campaign.id,
        campaignName: campaign.name,
        scheduledAt: result.scheduledAt,
        enrolled: result.enrolled,
      });
    } catch (e) {
      logger.error("job.campaign.auto_activation_error", {
        campaignId: campaign.id,
        campaignName: campaign.name,
        err: e.message,
      });

      try {
        const current = await prisma.workflow.findFirst({
          where: { id: campaign.id, orgId: campaign.orgId },
        });
        if (current) {
          const permanent = isPermanentCampaignConfigurationError(e);
          await prisma.workflow.update({
            where: { id: campaign.id },
            data: {
              active: false,
              conditions: {
                ...(current.conditions || {}),
                ...(permanent ? { status: "error", errorAt: new Date().toISOString() } : {}),
                lastError: e.message,
              },
            },
          });

          logger[permanent ? "warn" : "error"](
            permanent
              ? "job.campaign.auto_activation_configuration_error"
              : "job.campaign.auto_activation_retryable_error",
            {
              campaignId: campaign.id,
              campaignName: campaign.name,
              err: e.message,
            }
          );
        }
      } catch (updateErr) {
        logger.error("job.campaign.auto_activation_error_state_failed", {
          campaignId: campaign.id,
          err: updateErr.message,
        });
      }
    }
  }
};

const run = async () => {
  if (running) return;
  running = true;

  try {
    await activateDueCampaigns();
    await tasks.followupNewLeads();
    await tasks.processSequenceEnrollments();
  } catch (e) {
    logger.error("job.tick.error", { err: e.message });
  } finally {
    running = false;
  }
};

const start = () => {
  if (process.env.DISABLE_CRON === "true") {
    logger.warn("jobs.disabled", { reason: "DISABLE_CRON=true" });
    return;
  }

  void run();

  if (!schedulerInterval) {
    schedulerInterval = setInterval(() => {
      void run();
    }, 5_000);
    schedulerInterval.unref?.();
  }

  cron.schedule("0 2 * * *", tasks.dailySnapshot);

  logger.info("jobs.scheduled", {
    campaignScheduler: "5s-interval",
    startupCatchUp: true,
  });
};

module.exports = { start, tasks };