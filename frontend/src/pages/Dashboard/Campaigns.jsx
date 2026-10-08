// Marketing campaigns page.
import React, { useEffect, useState } from "react";
import { campaignService, tagService, savedSearchService } from "@/services";
import {
  UptoPage, UptoHero, UptoButton, UptoInput, UptoBadge,
  UptoSpinner, UptoError, UptoEmptyState, UptoCard,
} from "@/components/UI/UptoHooks";
import { Megaphone, Plus } from "lucide-react";
import { toast } from "sonner";

const LEAD_STATUS_OPTIONS = [
  { value: "new", label: "New" },
  { value: "contacted", label: "Contacted" },
  { value: "qualified", label: "Qualified" },
  { value: "in_progress", label: "In Progress" },
  { value: "converted", label: "Converted" },
  { value: "closed", label: "Closed" },
  { value: "lost", label: "Lost" },
];

const Campaigns = () => {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [tags, setTags] = useState([]);
  const [segments, setSegments] = useState([]);
  const [expandedId, setExpandedId] = useState(null);
  const [leadsByCampaign, setLeadsByCampaign] = useState({});
  const [loadingLeads, setLoadingLeads] = useState(false);
<<<<<<< HEAD
  const [showSegmentBuilder, setShowSegmentBuilder] = useState(false);
  const [segmentDraft, setSegmentDraft] = useState({ name: "", logic: "AND", conditions: [] });
=======

>>>>>>> d3d66e205d9fc999ef163b2b91283b8ef6c3641b
  const toLocalDateTimeInput = (value) => {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    const pad = (n) => String(n).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  };

  const [draft, setDraft] = useState({
    name: "",
    audience: { type: "all" },
    schedule: "",
    steps: [{ day: 0, subject: "", body: "" }],
  });

  const loadMetaData = async () => {
    try {
      const [tagsData, segmentsData] = await Promise.all([
        tagService.list(),
        savedSearchService.list({ resource: "leads" }),
      ]);
      setTags(tagsData || []);
      setSegments(segmentsData || []);
    } catch (err) {
      console.error("Failed to load audience metadata:", err);
    }
  };

  const load = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await campaignService.list({ limit: 100 });
      setItems(res?.items || res || []);
      setError(null);
    } catch (e) {
      setError(e?.message || "Failed to load");
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    load();
    loadMetaData();

    const interval = setInterval(() => {
      load(true);
    }, 15000);

<<<<<<< HEAD
  return () => clearInterval(interval);
}, []);
  useEffect(() => {
  if (expandedId === null) return;
=======
    return () => clearInterval(interval);
  }, []);
>>>>>>> d3d66e205d9fc999ef163b2b91283b8ef6c3641b

  const refreshLeads = async () => {
    try {
      const data = await campaignService.getLeads(expandedId);

      setLeadsByCampaign((prev) => ({
        ...prev,
        [expandedId]: data.leads || [],
      }));
    } catch (err) {
      console.error("Failed to refresh campaign leads:", err);
    }
  };

  const interval = setInterval(refreshLeads, 5000);

  return () => clearInterval(interval);
}, [expandedId]);
  const handleAudienceTypeChange = (type) => {
    if (type === "all") {
      setDraft({ ...draft, audience: { type: "all" } });
    } else if (type === "tag") {
<<<<<<< HEAD
      setDraft({ ...draft, audience: { type: "tag", tagIds: [] } });
=======
      setDraft({ ...draft, audience: { type: "tag", tagId: tags[0]?.id || "" } });
>>>>>>> d3d66e205d9fc999ef163b2b91283b8ef6c3641b
    } else if (type === "status") {
      setDraft({ ...draft, audience: { type: "status", status: "new" } });
    } else if (type === "score") {
      setDraft({
        ...draft,
        audience: {
          type: "score",
          operator: "gte",
          value: 80,
          min: "",
          max: "",
          conditions: [],
        },
      });
    } else if (type === "segment") {
      setDraft({
        ...draft,
        audience: { type: "segment", savedSearchId: segments[0]?.id || "" },
      });
    }
  };

  const renderAudienceLabel = (aud) => {
    if (!aud || aud === "all") return "All Leads";

    let audienceObj = aud;
    if (typeof aud === "string") {
      try {
        audienceObj = JSON.parse(aud);
      } catch (_) {
        return aud;
      }
    }

    if (audienceObj?.type === "all") return "All Leads";
<<<<<<< HEAD
       if (audienceObj?.type === "tag") {
      const ids = audienceObj.tagIds || (audienceObj.tagId ? [audienceObj.tagId] : []);
      const names = ids.map((id) => tags.find((t) => t.id === Number(id))?.name).filter(Boolean);
      return names.length ? `Tags: ${names.join(", ")}` : "Tag: —";
=======

    if (audienceObj?.type === "tag") {
      const tag = tags.find((t) => t.id === Number(audienceObj.tagId));
      return tag ? `Tag: ${tag.name}` : `Tag #${audienceObj.tagId}`;
>>>>>>> d3d66e205d9fc999ef163b2b91283b8ef6c3641b
    }

    if (audienceObj?.type === "status") {
      const matchedStatus = LEAD_STATUS_OPTIONS.find(
        (s) => s.value === audienceObj.status
      );
      return `Status: ${matchedStatus ? matchedStatus.label : audienceObj.status}`;
    }

    if (audienceObj?.type === "score") {
      const op =
        audienceObj.operator ||
        (audienceObj.min !== "" && audienceObj.max !== "" ? "between" : "gte");

      if (op === "between") {
        return `Score: ${audienceObj.min}–${audienceObj.max}`;
      }

      const symbols = { gt: ">", gte: "≥", lt: "<", lte: "≤" };
      return `Score: ${symbols[op] || "≥"} ${audienceObj.value ?? audienceObj.min ?? audienceObj.max}`;
    }

    if (audienceObj?.type === "segment") {
      const seg = segments.find(
        (s) => s.id === Number(audienceObj.savedSearchId)
      );
      return seg
        ? `Segment: ${seg.name}`
        : `Segment #${audienceObj.savedSearchId}`;
    }

    return "All Leads";
  };

  const resetDraft = () => {
    setDraft({
      name: "",
      audience: { type: "all" },
      schedule: "",
      steps: [{ day: 0, subject: "", body: "" }],
    });
  };

  const closeEditor = () => {
    setShowCreate(false);
    setEditingId(null);
    resetDraft();
  };

  const handleCreate = async (e) => {
    e.preventDefault();

    const aud = draft.audience;

    if (typeof aud === "object") {
      if (aud.type === "tag" && !aud.tagId) {
        toast.error("Please select a tag");
        return;
      }
<<<<<<< HEAD
      if (aud.type === "tag" && (!aud.tagIds || aud.tagIds.length === 0)) {
        toast.error("Please select at least one tag");
=======

      if (aud.type === "status" && !aud.status) {
        toast.error("Please select a status");
>>>>>>> d3d66e205d9fc999ef163b2b91283b8ef6c3641b
        return;
      }

      if (aud.type === "score") {
        const operator = aud.operator || "gte";

        if (operator === "between") {
          if (aud.min === "" || aud.max === "") {
            toast.error("Please provide both minimum and maximum scores");
            return;
          }

          if (Number(aud.min) > Number(aud.max)) {
            toast.error("Minimum score cannot be greater than maximum score");
            return;
          }
        } else if (aud.value === "" || aud.value === undefined) {
          toast.error("Please provide a score value");
          return;
        }
      }

      if (aud.type === "segment" && !aud.savedSearchId) {
        toast.error("Please select a segment");
        return;
      }
    }

    if (!draft.name.trim()) {
      toast.error("Please enter a campaign name.");
      return;
    }

    if (!draft.schedule) {
      toast.error("Please select a campaign start date.");
      return;
    }

    try {
      const startDate = draft.schedule.slice(0, 10);
      const startTime = draft.steps?.[0]?.time || "10:00";
      const scheduleDateTime = `${startDate}T${startTime}`;

      const payload = {
        ...draft,
        schedule: new Date(scheduleDateTime).toISOString(),
      };

      if (editingId) {
        await campaignService.update(editingId, payload);

        setLeadsByCampaign((prev) => {
          const next = { ...prev };
          delete next[editingId];
          return next;
        });

        toast.success("Campaign updated");
      } else {
        await campaignService.create(payload);
        toast.success("Campaign created");
      }

      closeEditor();
      await load();
    } catch (err) {
      toast.error(err?.message || "Operation failed");
    }
  };

  const handleLaunch = async (id) => {
    try {
      await campaignService.launch(id);
      toast.success("Campaign launched");
      load();
    } catch (err) {
      toast.error(err?.message || "Launch failed");
    }
  };

  const handlePause = async (id) => {
    try {
      await campaignService.pause(id);
      toast.success("Campaign paused");
      load();
    } catch (err) {
      toast.error(err?.message || "Pause failed");
    }
  };

  const handleStop = async (id) => {
    try {
      await campaignService.stop(id);
      toast.success("Campaign stopped");
      load();
    } catch (err) {
      toast.error(err?.message || "Stop failed");
    }
  };

  const handleResume = async (id) => {
    try {
      await campaignService.resume(id);
      toast.success("Campaign resumed");
      load();
    } catch (err) {
      toast.error(err?.message || "Resume failed");
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Delete this campaign?")) return;

    try {
      await campaignService.remove(id);
      toast.success("Campaign deleted");
      load();
    } catch (err) {
      toast.error(err?.message || "Delete failed");
    }
  };

  const toggleLeads = async (campaignId) => {
<<<<<<< HEAD
  const campaign = items.find((item) => item.id === campaignId);
  const isScheduled =
    campaign?.conditions?.status === "scheduled" && !campaign.active;

  if (expandedId === campaignId) {
    setExpandedId(null);
    return;
  }

  setExpandedId(campaignId);

  if (isScheduled) return;

  setLoadingLeads(true);

  try {
    const data = await campaignService.getLeads(campaignId);

    setLeadsByCampaign((prev) => ({
      ...prev,
      [campaignId]: data.leads || [],
    }));
  } catch (err) {
    toast.error(err?.message || "Failed to load leads");
  } finally {
    setLoadingLeads(false);
  }
};
=======
    const campaign = items.find((item) => item.id === campaignId);
    const isScheduled =
      campaign?.conditions?.status === "scheduled" && !campaign.active;

    if (expandedId === campaignId) {
      setExpandedId(null);
      return;
    }

    setExpandedId(campaignId);

    if (isScheduled) return;

    if (!leadsByCampaign[campaignId]) {
      setLoadingLeads(true);

      try {
        const data = await campaignService.getLeads(campaignId);
        setLeadsByCampaign((prev) => ({
          ...prev,
          [campaignId]: data?.leads || [],
        }));
      } catch (err) {
        toast.error(err?.message || "Failed to load leads");
      } finally {
        setLoadingLeads(false);
      }
    }
  };
>>>>>>> d3d66e205d9fc999ef163b2b91283b8ef6c3641b

  const handleEdit = (campaign) => {
    setEditingId(campaign.id);

    const rawAudience = campaign.conditions?.audience || "all";
    let audience = rawAudience;

    if (typeof rawAudience === "string" && rawAudience !== "all") {
      try {
        audience = JSON.parse(rawAudience);
      } catch (_) {
        audience = rawAudience;
      }
    }

    setDraft({
      name: campaign.name || "",
      audience,
      schedule: toLocalDateTimeInput(campaign.conditions?.schedule),
      steps: campaign.conditions?.steps?.length
        ? campaign.conditions.steps
        : [
            {
              day: 0,
              subject: campaign.conditions?.subject || "",
              body: campaign.conditions?.body || "",
              time: "10:00",
            },
          ],
    });

    setShowCreate(true);
  };

  const openNewCampaign = () => {
    setEditingId(null);
    resetDraft();
    setShowCreate(true);
  };

  return (
    <UptoPage>
      <UptoHero
        title="Campaigns"
        subtitle="Email and marketing automation"
        actions={
          <UptoButton onClick={openNewCampaign}>
            <Plus className="mr-1 h-4 w-4 inline" /> New campaign
          </UptoButton>
        }
      />

      <UptoCard>
        {loading && <UptoSpinner />}

        {error && <UptoError message={error} onRetry={load} />}

        {!loading && !error && items.length === 0 && (
          <UptoEmptyState
            icon={Megaphone}
            title="No campaigns"
            body="Create a campaign to reach your audience."
          />
        )}

        {!loading && !error && items.length > 0 && (
          <div className="space-y-2">
            {items.map((c) => (
              <div
                key={c.id}
                className="p-3 rounded-xl border border-slate-200 dark:border-slate-700"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium">{c.name}</div>

                    <div className="text-xs text-slate-500">
                      {renderAudienceLabel(c.conditions?.audience)} ·{" "}
                      {c.conditions?.schedule
                        ? new Date(c.conditions.schedule).toLocaleString()
                        : "No schedule"}{" "}
                      ·{" "}
                      {c.conditions?.steps?.length
                        ? `${c.conditions.steps.length} step${c.conditions.steps.length > 1 ? "s" : ""}`
                        : c.conditions?.subject || "—"}
                      {c.conditions?.status === "scheduled" && !c.active
                        ? ` · Expected Leads: ${c.expectedLeads ?? 0}`
                        : ""}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <UptoBadge>
                      {c.conditions?.status === "paused"
                        ? "Paused"
                        : c.conditions?.status === "scheduled"
                          ? "Scheduled"
                          : c.conditions?.status === "completed"
                            ? "Completed"
                            : c.conditions?.status === "error"
                              ? "Error"
                              : c.active
                                ? "Running"
                                : "Draft"}
                    </UptoBadge>

                    {c.conditions?.status === "paused" ? (
                      <>
                        <UptoButton
                          variant="ghost"
                          onClick={() => handleResume(c.id)}
                        >
                          Resume
                        </UptoButton>
                        <UptoButton
                          variant="secondary"
                          onClick={() => handleStop(c.id)}
                        >
                          Stop
                        </UptoButton>
                      </>
                    ) : c.conditions?.status === "cancelled" ? (
                      <span className="text-sm text-slate-500">Stopped</span>
                    ) : c.conditions?.status === "completed" ? (
                      <span className="text-sm text-slate-500">Completed</span>
                    ) : !c.active && c.conditions?.status === "scheduled" ? (
                      <span className="text-sm text-slate-500">
                        Waiting for schedule
                      </span>
                    ) : c.conditions?.status === "error" ? (
                      <span className="text-sm text-amber-600 dark:text-amber-400">
                        Configuration error — edit and reschedule
                      </span>
                    ) : !c.active ? (
                      <UptoButton
                        variant="ghost"
                        onClick={() => handleLaunch(c.id)}
                      >
                        Schedule
                      </UptoButton>
                    ) : (
                      <>
                        <UptoButton
                          variant="secondary"
                          onClick={() => handlePause(c.id)}
                        >
                          Pause
                        </UptoButton>
                        <UptoButton
                          variant="secondary"
                          onClick={() => handleStop(c.id)}
                        >
                          Stop
                        </UptoButton>
                      </>
                    )}

                    <UptoButton
                      variant="ghost"
                      onClick={() => toggleLeads(c.id)}
                    >
                      {c.conditions?.status === "scheduled" && !c.active
                        ? expandedId === c.id
                          ? "Hide Expected Leads"
                          : "View Expected Leads"
                        : expandedId === c.id
                          ? "Hide Leads"
                          : "View Leads"}
                    </UptoButton>

                    <UptoButton
                      variant="ghost"
                      onClick={() => handleEdit(c)}
                    >
                      Edit
                    </UptoButton>

                    <UptoButton
                      variant="danger"
                      onClick={() => handleDelete(c.id)}
                    >
                      Delete
                    </UptoButton>
                  </div>
                </div>

                {c.conditions?.status === "error" &&
                  c.conditions?.lastError && (
                    <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-950/20 p-3 text-xs">
                      <div className="font-semibold text-amber-800 dark:text-amber-300">
                        Campaign activation error
                      </div>
                      <div className="mt-1 text-amber-700 dark:text-amber-400">
                        {c.conditions.lastError}
                      </div>
                    </div>
                  )}

                {expandedId === c.id &&
                  c.conditions?.status === "scheduled" &&
                  !c.active && (
                    <div className="mt-3 rounded-lg bg-slate-50 dark:bg-slate-800/60 p-3">
                      <div className="text-xs font-semibold text-slate-600 dark:text-slate-300 mb-2">
                        Expected leads
                      </div>

                      {c.expectedLeadsPreview?.length ? (
                        <div className="space-y-2">
                          {c.expectedLeadsPreview.map((lead) => (
                            <div
                              key={lead.id}
                              className="grid grid-cols-1 sm:grid-cols-4 gap-1 text-xs"
                            >
                              <span className="font-medium">
                                {lead.name || "—"}
                              </span>
                              <span>{lead.email || "—"}</span>
                              <span>{lead.companyName || "—"}</span>
                              <UptoBadge>{lead.status || "—"}</UptoBadge>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="text-xs text-slate-500">
                          No matching leads currently.
                        </div>
                      )}
                    </div>
                  )}

                {expandedId === c.id &&
                  !(
                    c.conditions?.status === "scheduled" &&
                    !c.active
                  ) && (
                    <div className="mt-3 pt-3 border-t border-slate-200 dark:border-slate-700">
                      {loadingLeads ? (
                        <UptoSpinner />
                      ) : leadsByCampaign[c.id]?.length ? (
                        <div className="space-y-1">
                          {leadsByCampaign[c.id].map((l) => (
                            <div
                              key={l.enrollmentId}
                              className="flex items-center justify-between text-xs py-1"
                            >
                              <span>
                                {l.name || "—"} · {l.email}
                              </span>
                              <span className="text-slate-500">
                                {l.companyName || "—"}
                              </span>
                              <UptoBadge>{l.enrollmentStatus}</UptoBadge>
                              <span className="text-slate-400">
                                {l.enrollmentStatus === "COMPLETED"
                                  ? `Step ${l.totalSteps}/${l.totalSteps}`
                                  : `Step ${l.currentStep + 1}/${l.totalSteps}`}
                              </span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="text-xs text-slate-500">
                          No leads enrolled yet.
                        </div>
                      )}
                    </div>
                  )}
              </div>
            ))}
          </div>
        )}
      </UptoCard>

      {showCreate && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <form
            onSubmit={handleCreate}
            className="bg-white dark:bg-slate-900 rounded-2xl p-6 max-w-md w-full max-h-[90vh] overflow-y-auto"
          >
            <h3 className="text-lg font-semibold mb-4">
              {editingId ? "Edit campaign" : "New campaign"}
            </h3>

            <div className="space-y-3">
              <UptoInput
                label="Name"
                value={draft.name}
                onChange={(e) =>
                  setDraft({ ...draft, name: e.target.value })
                }
                required
              />

              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
                  Target Audience
                </label>

                <select
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={
                    typeof draft.audience === "string"
                      ? draft.audience === "all"
                        ? "all"
                        : "all"
                      : draft.audience?.type || "all"
                  }
                  onChange={(e) =>
                    handleAudienceTypeChange(e.target.value)
                  }
                >
                  <option value="all">All Leads</option>
                  <option value="status">By Status</option>
                  <option value="tag">By Tag</option>
                  <option value="segment">By Saved Segment</option>
                  <option value="score">By Score</option>
                </select>

<<<<<<< HEAD
                                {(typeof draft.audience === "object" && draft.audience?.type === "tag") && (
                  <div className="mt-2">
                    <label className="text-xs text-slate-500 mb-1 block">Select Tags (matches ANY selected)</label>
                    {tags.length === 0 ? (
                      <div className="text-xs text-amber-600 dark:text-amber-400">No tags available. Please create tags first in Leads.</div>
                    ) : (
                      <div className="space-y-1 max-h-40 overflow-y-auto border border-slate-200 dark:border-slate-700 rounded-xl p-2">
                        {tags.map((t) => {
                          const selected = (draft.audience?.tagIds || []).includes(t.id);
                          return (
                            <label key={t.id} className="flex items-center gap-2 text-sm cursor-pointer">
                              <input
                                type="checkbox"
                                checked={selected}
                                onChange={(e) => {
                                  const current = draft.audience?.tagIds || [];
                                  const tagIds = e.target.checked
                                    ? [...current, t.id]
                                    : current.filter((id) => id !== t.id);
                                  setDraft({ ...draft, audience: { type: "tag", tagIds } });
                                }}
                              />
                              {t.name}
                            </label>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                {(typeof draft.audience === "object" && draft.audience?.type === "score") && (
                  <div className="mt-2 space-y-3">
                    <label className="text-xs text-slate-500 block">Score condition</label>
 <div className="grid grid-cols-2 gap-2">
  {/* Score Operator */}
  <div className="min-w-0 -mt-6">
    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
      &nbsp;
    </label>

    <select
      className="w-full min-w-0 h-[42px] rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
      value={draft.audience?.operator || "gte"}
      onChange={(e) =>
        setDraft({
          ...draft,
          audience: {
            ...draft.audience,
            operator: e.target.value,
          },
        })
      }
    >
      <option value="gt">&gt; Greater than</option>
      <option value="gte">≥ Greater than or equal</option>
      <option value="lt">&lt; Less than</option>
      <option value="lte">≤ Less than or equal</option>
      <option value="between">Between</option>
    </select>
  </div>

  {/* Score Value */}
 <div className="min-w-0 -mt-6">
    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
      {draft.audience?.operator === "between" ? "Minimum" : "Score"}
    </label>

    <input
      type="number"
      min="0"
      className="w-full min-w-0 h-[42px] rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
      value={
        draft.audience?.operator === "between"
          ? (draft.audience?.min ?? "")
          : (draft.audience?.value ?? "")
      }
      onChange={(e) => {
        const value =
          e.target.value === "" ? "" : Number(e.target.value);

        setDraft({
          ...draft,
          audience:
            draft.audience?.operator === "between"
              ? { ...draft.audience, min: value }
              : { ...draft.audience, value },
        });
      }}
    />
  </div>
</div>
                    {draft.audience?.operator === "between" && (
                      <UptoInput
                        label="Maximum"
                        type="number"
                        min="0"
                        value={draft.audience?.max ?? ""}
                        onChange={(e) => setDraft({
                          ...draft,
                          audience: { ...draft.audience, max: e.target.value === "" ? "" : Number(e.target.value) },
                        })}
                      />
                    )}

                                        <div className="border-t border-slate-200 dark:border-slate-700 pt-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-xs text-slate-500 block">Additional conditions (AND)</label>
                        <button
                          type="button"
                          className="text-xs text-blue-600 dark:text-blue-400"
                          onClick={() => {
                            const conditions = [...(draft.audience?.conditions || []), { field: "status", operator: "equals", value: "new" }];
                            setDraft({ ...draft, audience: { ...draft.audience, conditions } });
                          }}
                        >
                          + Add condition
                        </button>
                      </div>

                      {(draft.audience?.conditions || []).map((cond, idx) => (
                        <div key={idx} className="flex items-center gap-2">
                          <select
                            className="flex-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-2 text-sm"
                            value={cond.field}
                            onChange={(e) => {
                              const field = e.target.value;
                              const conditions = [...draft.audience.conditions];
                              conditions[idx] = { field, operator: "equals", value: field === "status" ? "new" : field === "tagId" ? (tags[0]?.id || "") : "" };
                              setDraft({ ...draft, audience: { ...draft.audience, conditions } });
                            }}
                          >
                            <option value="status">Status</option>
                            <option value="tagId">Tag</option>
                            <option value="source">Source</option>
                            <option value="industry">Industry</option>
                            <option value="companySize">Company Size</option>
                            <option value="jobTitle">Job Title</option>
                          </select>

                          {cond.field === "status" ? (
                            <select
                              className="flex-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-2 text-sm"
                              value={cond.value || ""}
                              onChange={(e) => {
                                const conditions = [...draft.audience.conditions];
                                conditions[idx] = { ...conditions[idx], value: e.target.value };
                                setDraft({ ...draft, audience: { ...draft.audience, conditions } });
                              }}
                            >
                              {LEAD_STATUS_OPTIONS.map((st) => (
                                <option key={st.value} value={st.value}>{st.label}</option>
                              ))}
                            </select>
                          ) : cond.field === "tagId" ? (
                            <select
                              className="flex-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-2 text-sm"
                              value={cond.value || ""}
                              onChange={(e) => {
                                const conditions = [...draft.audience.conditions];
                                conditions[idx] = { ...conditions[idx], value: Number(e.target.value) };
                                setDraft({ ...draft, audience: { ...draft.audience, conditions } });
                              }}
                            >
                              {tags.map((tag) => <option key={tag.id} value={tag.id}>{tag.name}</option>)}
                            </select>
                          ) : (
                            <input
                              className="flex-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-2 text-sm"
                              placeholder="Value"
                              value={cond.value || ""}
                              onChange={(e) => {
                                const conditions = [...draft.audience.conditions];
                                conditions[idx] = { ...conditions[idx], value: e.target.value };
                                setDraft({ ...draft, audience: { ...draft.audience, conditions } });
                              }}
                            />
                          )}

                          <button
                            type="button"
                            className="text-red-500 text-sm px-2"
                            onClick={() => {
                              const conditions = draft.audience.conditions.filter((_, i) => i !== idx);
                              setDraft({ ...draft, audience: { ...draft.audience, conditions } });
                            }}
                          >
                            ✕
                          </button>
                        </div>
                      ))}
=======
                {typeof draft.audience === "object" &&
                  draft.audience?.type === "tag" && (
                    <div className="mt-2">
                      <label className="text-xs text-slate-500 mb-1 block">
                        Select Tag
                      </label>

                      {tags.length === 0 ? (
                        <div className="text-xs text-amber-600 dark:text-amber-400">
                          No tags available. Please create tags first in Leads.
                        </div>
                      ) : (
                        <select
                          className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-2 text-sm"
                          value={draft.audience?.tagId || ""}
                          onChange={(e) =>
                            setDraft({
                              ...draft,
                              audience: {
                                type: "tag",
                                tagId: Number(e.target.value),
                              },
                            })
                          }
                        >
                          {tags.map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.name}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                  )}

                {typeof draft.audience === "object" &&
                  draft.audience?.type === "score" && (
                    <div className="mt-2 space-y-3">
                      <label className="text-xs text-slate-500 block">
                        Score condition
                      </label>

                      <div className="grid grid-cols-2 gap-2">
                        <select
                          className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-2 text-sm"
                          value={draft.audience?.operator || "gte"}
                          onChange={(e) =>
                            setDraft({
                              ...draft,
                              audience: {
                                ...draft.audience,
                                operator: e.target.value,
                              },
                            })
                          }
                        >
                          <option value="gt">&gt; Greater than</option>
                          <option value="gte">
                            ≥ Greater than or equal
                          </option>
                          <option value="lt">&lt; Less than</option>
                          <option value="lte">≤ Less than or equal</option>
                          <option value="between">Between</option>
                        </select>

                        <UptoInput
                          label={
                            draft.audience?.operator === "between"
                              ? "Minimum"
                              : "Score"
                          }
                          type="number"
                          min="0"
                          value={
                            draft.audience?.operator === "between"
                              ? draft.audience?.min ?? ""
                              : draft.audience?.value ?? ""
                          }
                          onChange={(e) => {
                            const value =
                              e.target.value === ""
                                ? ""
                                : Number(e.target.value);

                            setDraft({
                              ...draft,
                              audience:
                                draft.audience?.operator === "between"
                                  ? {
                                      ...draft.audience,
                                      min: value,
                                    }
                                  : {
                                      ...draft.audience,
                                      value,
                                    },
                            });
                          }}
                        />
                      </div>

                      {draft.audience?.operator === "between" && (
                        <UptoInput
                          label="Maximum"
                          type="number"
                          min="0"
                          value={draft.audience?.max ?? ""}
                          onChange={(e) =>
                            setDraft({
                              ...draft,
                              audience: {
                                ...draft.audience,
                                max:
                                  e.target.value === ""
                                    ? ""
                                    : Number(e.target.value),
                              },
                            })
                          }
                        />
                      )}

                      <div className="border-t border-slate-200 dark:border-slate-700 pt-3 space-y-2">
                        <label className="text-xs text-slate-500 block">
                          Optional additional conditions (AND)
                        </label>

                        <select
                          className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-2 text-sm"
                          value={
                            draft.audience?.conditions?.[0]?.field || ""
                          }
                          onChange={(e) => {
                            const field = e.target.value;
                            const conditions = field
                              ? [
                                  {
                                    field,
                                    operator: "equals",
                                    value:
                                      field === "status"
                                        ? "new"
                                        : tags[0]?.id || "",
                                  },
                                ]
                              : [];

                            setDraft({
                              ...draft,
                              audience: {
                                ...draft.audience,
                                conditions,
                              },
                            });
                          }}
                        >
                          <option value="">
                            No additional condition
                          </option>
                          <option value="status">Status</option>
                          <option value="tagId">Tag</option>
                        </select>

                        {draft.audience?.conditions?.[0]?.field ===
                          "status" && (
                          <select
                            className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-2 text-sm"
                            value={
                              draft.audience.conditions[0].value || ""
                            }
                            onChange={(e) =>
                              setDraft({
                                ...draft,
                                audience: {
                                  ...draft.audience,
                                  conditions: [
                                    {
                                      ...draft.audience.conditions[0],
                                      value: e.target.value,
                                    },
                                  ],
                                },
                              })
                            }
                          >
                            {LEAD_STATUS_OPTIONS.map((st) => (
                              <option key={st.value} value={st.value}>
                                {st.label}
                              </option>
                            ))}
                          </select>
                        )}

                        {draft.audience?.conditions?.[0]?.field ===
                          "tagId" && (
                          <select
                            className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-2 text-sm"
                            value={
                              draft.audience.conditions[0].value || ""
                            }
                            onChange={(e) =>
                              setDraft({
                                ...draft,
                                audience: {
                                  ...draft.audience,
                                  conditions: [
                                    {
                                      ...draft.audience.conditions[0],
                                      value: Number(e.target.value),
                                    },
                                  ],
                                },
                              })
                            }
                          >
                            {tags.map((tag) => (
                              <option key={tag.id} value={tag.id}>
                                {tag.name}
                              </option>
                            ))}
                          </select>
                        )}
                      </div>
>>>>>>> d3d66e205d9fc999ef163b2b91283b8ef6c3641b
                    </div>
                  )}

                {typeof draft.audience === "object" &&
                  draft.audience?.type === "status" && (
                    <div className="mt-2">
                      <label className="text-xs text-slate-500 mb-1 block">
                        Select Lead Status
                      </label>

<<<<<<< HEAD
                                {(typeof draft.audience === "object" && draft.audience?.type === "segment") && (
                  <div className="mt-2 space-y-2">
                    <label className="text-xs text-slate-500 mb-1 block">Select Saved Segment</label>
                    {segments.length === 0 ? (
                      <div className="text-xs text-amber-600 dark:text-amber-400">No lead segments saved yet.</div>
                    ) : (
=======
>>>>>>> d3d66e205d9fc999ef163b2b91283b8ef6c3641b
                      <select
                        className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-2 text-sm"
                        value={draft.audience?.status || "new"}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            audience: {
                              type: "status",
                              status: e.target.value,
                            },
                          })
                        }
                      >
                        {LEAD_STATUS_OPTIONS.map((st) => (
                          <option key={st.value} value={st.value}>
                            {st.label}
                          </option>
                        ))}
                      </select>
<<<<<<< HEAD
                    )}

                    <button
                      type="button"
                      className="text-xs text-blue-600 dark:text-blue-400"
                      onClick={() => setShowSegmentBuilder((v) => !v)}
                    >
                      {showSegmentBuilder ? "Cancel new segment" : "+ Create new segment"}
                    </button>

                    {showSegmentBuilder && (
                      <div className="border border-slate-200 dark:border-slate-700 rounded-xl p-3 space-y-2">
                        <input
                          className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-2 text-sm"
                          placeholder="Segment name (e.g. Hot & Qualified)"
                          value={segmentDraft.name}
                          onChange={(e) => setSegmentDraft({ ...segmentDraft, name: e.target.value })}
                        />

                        <div className="flex items-center justify-between">
                          <label className="text-xs text-slate-500">Conditions</label>
                          <div className="flex items-center gap-2">
                            <select
                              className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-1 text-xs"
                              value={segmentDraft.logic}
                              onChange={(e) => setSegmentDraft({ ...segmentDraft, logic: e.target.value })}
                            >
                              <option value="AND">Match ALL (AND)</option>
                              <option value="OR">Match ANY (OR)</option>
                            </select>
                            <button
                              type="button"
                              className="text-xs text-blue-600 dark:text-blue-400"
                              onClick={() => setSegmentDraft({
                                ...segmentDraft,
                                conditions: [...segmentDraft.conditions, { field: "status", operator: "equals", value: "qualified" }],
                              })}
                            >
                              + Add
                            </button>
                          </div>
                        </div>

                        {segmentDraft.conditions.map((cond, idx) => (
                          <div key={idx} className="flex items-center gap-1">
                            <select
                              className="flex-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-1.5 text-xs"
                              value={cond.field}
                              onChange={(e) => {
                                const conditions = [...segmentDraft.conditions];
                                conditions[idx] = { ...conditions[idx], field: e.target.value };
                                setSegmentDraft({ ...segmentDraft, conditions });
                              }}
                            >
                              <option value="status">Status</option>
                              <option value="score">Score</option>
                              <option value="source">Source</option>
                              <option value="industry">Industry</option>
                              <option value="companySize">Company Size</option>
                              <option value="jobTitle">Job Title</option>
                              <option value="tagId">Tag</option>
                            </select>
                            <select
                              className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-1.5 text-xs"
                              value={cond.operator}
                              onChange={(e) => {
                                const conditions = [...segmentDraft.conditions];
                                conditions[idx] = { ...conditions[idx], operator: e.target.value };
                                setSegmentDraft({ ...segmentDraft, conditions });
                              }}
                            >
                              <option value="equals">=</option>
                              <option value="not_equals">≠</option>
                              <option value="gt">&gt;</option>
                              <option value="gte">≥</option>
                              <option value="lt">&lt;</option>
                              <option value="lte">≤</option>
                              <option value="contains">contains</option>
                            </select>
                            {cond.field === "status" ? (
                              <select
                                className="flex-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-1.5 text-xs"
                                value={cond.value}
                                onChange={(e) => {
                                  const conditions = [...segmentDraft.conditions];
                                  conditions[idx] = { ...conditions[idx], value: e.target.value };
                                  setSegmentDraft({ ...segmentDraft, conditions });
                                }}
                              >
                                {LEAD_STATUS_OPTIONS.map((st) => (
                                  <option key={st.value} value={st.value}>{st.label}</option>
                                ))}
                              </select>
                            ) : cond.field === "tagId" ? (
                              <select
                                className="flex-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-1.5 text-xs"
                                value={cond.value}
                                onChange={(e) => {
                                  const conditions = [...segmentDraft.conditions];
                                  conditions[idx] = { ...conditions[idx], value: Number(e.target.value) };
                                  setSegmentDraft({ ...segmentDraft, conditions });
                                }}
                              >
                                {tags.map((tag) => <option key={tag.id} value={tag.id}>{tag.name}</option>)}
                              </select>
                            ) : (
                              <input
                                className="flex-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-1.5 text-xs"
                                placeholder="Value"
                                value={cond.value}
                                onChange={(e) => {
                                  const conditions = [...segmentDraft.conditions];
                                  const raw = e.target.value;
                                  conditions[idx] = { ...conditions[idx], value: cond.field === "score" ? Number(raw) : raw };
                                  setSegmentDraft({ ...segmentDraft, conditions });
                                }}
                              />
                            )}
                            <button
                              type="button"
                              className="text-red-500 text-xs px-1"
                              onClick={() => setSegmentDraft({
                                ...segmentDraft,
                                conditions: segmentDraft.conditions.filter((_, i) => i !== idx),
                              })}
                            >
                              ✕
                            </button>
                          </div>
                        ))}

                        <UptoButton
                          type="button"
                          onClick={async () => {
                            if (!segmentDraft.name.trim()) {
                              toast.error("Please name the segment");
                              return;
                            }
                            if (segmentDraft.conditions.length === 0) {
                              toast.error("Add at least one condition");
                              return;
                            }
                            try {
                              const saved = await savedSearchService.create({
                                name: segmentDraft.name,
                                resource: "leads",
                                filters: { logic: segmentDraft.logic, conditions: segmentDraft.conditions },
                              });
                              toast.success("Segment created");
                              const newSeg = saved?.data || saved;
                              setSegments((prev) => [...prev, newSeg]);
                              setDraft({ ...draft, audience: { type: "segment", savedSearchId: newSeg.id } });
                              setShowSegmentBuilder(false);
                              setSegmentDraft({ name: "", logic: "AND", conditions: [] });
                            } catch (err) {
                              toast.error(err?.message || "Failed to create segment");
                            }
                          }}
                        >
                          Save Segment
                        </UptoButton>
                      </div>
                    )}
                  </div>
                )}
=======
                    </div>
                  )}

                {typeof draft.audience === "object" &&
                  draft.audience?.type === "segment" && (
                    <div className="mt-2">
                      <label className="text-xs text-slate-500 mb-1 block">
                        Select Saved Segment
                      </label>

                      {segments.length === 0 ? (
                        <div className="text-xs text-amber-600 dark:text-amber-400">
                          No lead segments saved yet.
                        </div>
                      ) : (
                        <select
                          className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-2 text-sm"
                          value={draft.audience?.savedSearchId || ""}
                          onChange={(e) =>
                            setDraft({
                              ...draft,
                              audience: {
                                type: "segment",
                                savedSearchId: Number(e.target.value),
                              },
                            })
                          }
                        >
                          {segments.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                  )}
>>>>>>> d3d66e205d9fc999ef163b2b91283b8ef6c3641b
              </div>

              <UptoInput
                label="Campaign Start Date"
                type="date"
                min={new Date().toISOString().slice(0, 10)}
                value={(draft.schedule || "").slice(0, 10)}
                onChange={(e) =>
                  setDraft({ ...draft, schedule: e.target.value })
                }
                required
              />

              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h4 className="font-medium">Campaign Steps</h4>

                  <UptoButton
                    type="button"
                    variant="ghost"
                    onClick={() =>
                      setDraft({
                        ...draft,
                        steps: [
                          ...draft.steps,
                          {
                            day:
                              draft.steps.length === 0
                                ? 0
                                : draft.steps[draft.steps.length - 1].day + 1,
                            subject: "",
                            body: "",
                            time: "10:00",
                          },
                        ],
                      })
                    }
                  >
                    + Add Step
                  </UptoButton>
                </div>

                {draft.steps.map((step, index) => (
                  <div
                    key={index}
                    className="border border-slate-200 dark:border-slate-700 rounded-xl p-4 space-y-3"
                  >
                    <div className="flex items-center justify-between">
                      <h5 className="font-medium">Step {index + 1}</h5>

                      {draft.steps.length > 1 && (
                        <UptoButton
                          type="button"
                          variant="danger"
                          onClick={() =>
                            setDraft({
                              ...draft,
                              steps: draft.steps.filter(
                                (_, i) => i !== index
                              ),
                            })
                          }
                        >
                          Remove
                        </UptoButton>
                      )}
                    </div>

                    <UptoInput
                      label="Day"
                      type="number"
                      min="0"
                      value={step.day}
                      onChange={(e) => {
                        const steps = [...draft.steps];
                        steps[index] = {
                          ...steps[index],
                          day: Number(e.target.value),
                        };
                        setDraft({ ...draft, steps });
                      }}
                      required
                    />

                    <UptoInput
                      label="Time"
                      type="time"
                      value={step.time || "10:00"}
                      onChange={(e) => {
                        const steps = [...draft.steps];
                        steps[index] = {
                          ...steps[index],
                          time: e.target.value,
                        };
                        setDraft({ ...draft, steps });
                      }}
                      required
                    />

                    <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 p-3 text-sm">
                      <div className="font-medium">Email content</div>
                      <div className="text-xs text-slate-500 mt-1">
                        Gemini automatically generates a personalized subject and email body for each matching lead when the campaign runs.
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <UptoButton
                type="button"
                variant="ghost"
                onClick={closeEditor}
              >
                Cancel
              </UptoButton>

              <UptoButton type="submit">
                {editingId ? "Save Changes" : "Create"}
              </UptoButton>
            </div>
          </form>
        </div>
      )}
    </UptoPage>
  );
};

export default Campaigns;
