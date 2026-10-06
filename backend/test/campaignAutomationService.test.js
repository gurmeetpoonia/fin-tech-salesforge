const test = require("node:test");
const assert = require("node:assert/strict");

const prisma = {
  savedSearch: {
    findFirst: async () => null,
  },
};

const postgresModulePath = require.resolve("../config/postgres");
const originalPostgres = require.cache[postgresModulePath];

require.cache[postgresModulePath] = {
  id: postgresModulePath,
  filename: postgresModulePath,
  loaded: true,
  exports: { prisma },
};

const {
  leadMatchesAudience,
  getMatchingCampaignLeads,
  getCampaignAudienceCount,
} = require("../services/campaignAutomationService");

test.after(() => {
  if (originalPostgres) {
    require.cache[postgresModulePath] = originalPostgres;
  } else {
    delete require.cache[postgresModulePath];
  }
});

test("campaign audience matcher exports expected functions", () => {
  assert.equal(typeof leadMatchesAudience, "function");
  assert.equal(typeof getMatchingCampaignLeads, "function");
  assert.equal(typeof getCampaignAudienceCount, "function");
});

test("all audience matches a lead", async () => {
  const lead = { id: 1, email: "lead@example.com", status: "new", score: 20 };
  assert.equal(await leadMatchesAudience(lead, "all", 10), true);
});

test("status audience matches only the requested status", async () => {
  const lead = { id: 1, email: "lead@example.com", status: "new" };

  assert.equal(
    await leadMatchesAudience(lead, { type: "status", status: "new" }, 10),
    true
  );
  assert.equal(
    await leadMatchesAudience(lead, { type: "status", status: "contacted" }, 10),
    false
  );
});

test("tag audience matches a lead tag", async () => {
  const lead = {
    id: 1,
    email: "lead@example.com",
    tags: [{ tagId: 7 }],
  };

  assert.equal(
    await leadMatchesAudience(lead, { type: "tag", tagId: 7 }, 10),
    true
  );
  assert.equal(
    await leadMatchesAudience(lead, { type: "tag", tagId: 8 }, 10),
    false
  );
});

test("score audience supports comparison operators", async () => {
  const lead = { id: 1, email: "lead@example.com", score: 75 };

  assert.equal(
    await leadMatchesAudience(lead, { type: "score", operator: "gt", value: 70 }, 10),
    true
  );
  assert.equal(
    await leadMatchesAudience(lead, { type: "score", operator: "gte", value: 75 }, 10),
    true
  );
  assert.equal(
    await leadMatchesAudience(lead, { type: "score", operator: "lt", value: 75 }, 10),
    false
  );
  assert.equal(
    await leadMatchesAudience(lead, { type: "score", operator: "lte", value: 75 }, 10),
    true
  );
});

test("score audience supports between ranges and additional AND conditions", async () => {
  const lead = {
    id: 1,
    email: "lead@example.com",
    status: "qualified",
    score: 75,
    tags: [{ tagId: 9 }],
  };

  const audience = {
    type: "score",
    operator: "between",
    min: 70,
    max: 80,
    conditions: [
      { field: "status", operator: "equals", value: "qualified" },
      { field: "tagId", operator: "equals", value: 9 },
    ],
  };

  assert.equal(await leadMatchesAudience(lead, audience, 10), true);

  const wrongStatus = { ...lead, status: "new" };
  assert.equal(await leadMatchesAudience(wrongStatus, audience, 10), false);
});

test("saved segment uses its stored lead filters", async () => {
  prisma.savedSearch.findFirst = async () => ({
    id: 42,
    resource: "leads",
    filters: {
      conditions: [
        { field: "status", operator: "equals", value: "qualified" },
        { field: "tagId", operator: "equals", value: 12 },
      ],
    },
  });

  const matchingLead = {
    id: 1,
    email: "lead@example.com",
    status: "qualified",
    tags: [{ tagId: 12 }],
  };
  const nonMatchingLead = {
    id: 2,
    email: "lead2@example.com",
    status: "qualified",
    tags: [{ tagId: 13 }],
  };

  assert.equal(
    await leadMatchesAudience(
      matchingLead,
      { type: "segment", savedSearchId: 42 },
      10
    ),
    true
  );
  assert.equal(
    await leadMatchesAudience(
      nonMatchingLead,
      { type: "segment", savedSearchId: 42 },
      10
    ),
    false
  );
});
