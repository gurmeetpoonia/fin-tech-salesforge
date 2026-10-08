const { prisma } = require("../config/postgres");
const { AppError } = require("../middleware/errorHandler");
const asyncHandler = require("../utils/asyncHandler");
const response = require("../utils/response");
const slugify = require("../utils/slugify");
const { incrementUsage } = require("../services/usageService");
const { enrollLeadInActiveCampaigns } = require("../services/campaignAutomationService");

// 1. List: Sabhi tags load karega (chahe kisi bhi org ya user ke bane hon)
const list = asyncHandler(async (req, res) => {
  const currentOrgId = req.orgId || req.user?.orgId;
  const items = await prisma.tag.findMany({
    where: {
      OR: [
        { orgId: currentOrgId ? Number(currentOrgId) : undefined },
        { orgId: null },
        { id: { gt: 0 } }, // Universal: Saare existing tags show karega
      ],
    },
    orderBy: { name: "asc" },
    include: { _count: { select: { leads: true } } },
  });
  return response.success(res, items);
});

// 2. Create: Naya tag banate waqt orgId aur userId attach karein
const create = asyncHandler(async (req, res) => {
  const { name, color } = req.body;
  if (!name) throw new AppError("Tag name is required.", 400);
  const slug = slugify(name);
  try {
    const tag = await prisma.tag.create({
      data: {
        name,
        slug,
        color: color || "#3b82f6",
        orgId: req.orgId || req.user?.orgId || null,
        userId: req.user?.id || null,
      },
    });
    if (req.user?.id && req.orgId) {
      await incrementUsage({ userId: req.user.id, orgId: req.orgId, resource: "tags" }).catch(() => {});
    }
    return response.created(res, tag);
  } catch (error) {
    if (error.code === "P2002") throw new AppError("A tag with this name already exists.", 409);
    throw error;
  }
});

// 3. Update: Strict orgId filter hatakar direct update
const update = asyncHandler(async (req, res) => {
  const { name, color } = req.body;
  const data = {};
  if (name !== undefined) {
    data.name = name;
    data.slug = slugify(name);
  }
  if (color !== undefined) data.color = color;
  
  const result = await prisma.tag.updateMany({
    where: { id: Number(req.params.id) },
    data,
  });
  if (result.count === 0) throw new AppError("Tag not found.", 404);
  return response.success(res, { message: "Tag updated." });
});

// 4. Remove: Strict orgId filter hatakar direct delete
const remove = asyncHandler(async (req, res) => {
  const result = await prisma.tag.deleteMany({
    where: { id: Number(req.params.id) },
  });
  if (result.count === 0) throw new AppError("Tag not found.", 404);
  return response.success(res, { message: "Tag removed." });
});

// 5. AttachToLead: Kisi bhi user ke tag ko lead par attach karne ki permission
const attachToLead = asyncHandler(async (req, res) => {
  const { leadId } = req.params;
  const { tagId } = req.body;

  // Lead check karein
  const lead = await prisma.lead.findFirst({ 
    where: { id: Number(leadId) } 
  });
  if (!lead) throw new AppError("Lead not found.", 404);

  // Tag check karein (bina kisi orgId restriction ke)
  const tag = await prisma.tag.findFirst({ 
    where: { id: Number(tagId) } 
  });
  if (!tag) throw new AppError("Tag not found.", 404);

  await prisma.leadTag.upsert({
    where: { leadId_tagId: { leadId: lead.id, tagId: tag.id } },
    create: { leadId: lead.id, tagId: tag.id },
    update: {},
  });

  // Re-check active campaigns
  await enrollLeadInActiveCampaigns(lead, lead.orgId || req.orgId, req.user.id);

  return response.success(res, { message: "Tag attached." });
});

// 6. DetachFromLead
const detachFromLead = asyncHandler(async (req, res) => {
  const { leadId, tagId } = req.params;
  await prisma.leadTag.deleteMany({
    where: { leadId: Number(leadId), tagId: Number(tagId) },
  });

  const lead = await prisma.lead.findFirst({ where: { id: Number(leadId) } });
  if (lead) {
    await enrollLeadInActiveCampaigns(
      lead,
      lead.orgId || req.orgId,
      req.user.id
    );
  }

  return response.success(res, { message: "Tag detached." });
});

// 7. ListForLead
const listForLead = asyncHandler(async (req, res) => {
  const { leadId } = req.params;
  const items = await prisma.leadTag.findMany({
    where: { leadId: Number(leadId) },
    include: { tag: true },
  });
  return response.success(res, items.map((i) => i.tag));
});

module.exports = { list, create, update, remove, attachToLead, detachFromLead, listForLead };