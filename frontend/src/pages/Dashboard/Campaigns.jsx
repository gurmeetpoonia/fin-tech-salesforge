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
    steps: [
      {
        day: 0,
        subject: "",
        body: "",
      },
    ],
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
  } catch (e) { setError(e?.message || "Failed to load"); }
  finally { if (!silent) setLoading(false); }
};

 useEffect(() => {
  load();
  loadMetaData();

  const interval = setInterval(() => {
    load(true);
  }, 15000); // every 15 seconds

  return () => clearInterval(interval);
}, []);

  const handleAudienceTypeChange = (type) => {
    if (type === "all") {
      setDraft({ ...draft, audience: { type: "all" } });
    } else if (type === "tag") {
      const firstTagId = tags[0]?.id || "";
      setDraft({ ...draft, audience: { type: "tag", tagId: firstTagId } });
    } else if (type === "status") {
      setDraft({ ...draft, audience: { type: "status", status: "new" } });
    } else if (type === "score") {
      setDraft({ ...draft, audience: { type: "score", min: 80, max: "" } });
    } else if (type === "segment") {
      const firstSegId = segments[0]?.id || "";
      setDraft({ ...draft, audience: { type: "segment", savedSearchId: firstSegId } });
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
    if (audienceObj?.type === "tag") {
      const tag = tags.find((t) => t.id === Number(audienceObj.tagId));
      return tag ? `Tag: ${tag.name}` : `Tag #${audienceObj.tagId}`;
    }
    if (audienceObj?.type === "status") {
      const matchedStatus = LEAD_STATUS_OPTIONS.find((s) => s.value === audienceObj.status);
      return `Status: ${matchedStatus ? matchedStatus.label : audienceObj.status}`;
    }
    if (audienceObj?.type === "score") {
      if (audienceObj.min !== "" && audienceObj.max !== "") return `Score: ${audienceObj.min}–${audienceObj.max}`;
      if (audienceObj.min !== "") return `Score: ≥ ${audienceObj.min}`;
      return `Score: ≤ ${audienceObj.max}`;
    }
    if (audienceObj?.type === "segment") {
      const seg = segments.find((s) => s.id === Number(audienceObj.savedSearchId));
      return seg ? `Segment: ${seg.name}` : `Segment #${audienceObj.savedSearchId}`;
    }
    return "All Leads";
  };

  const handleCreate = async (e) => {
    e.preventDefault();

    const aud = draft.audience;
    if (typeof aud === "object") {
      if (aud.type === "tag" && !aud.tagId) {
        toast.error("Please select a tag");
        return;
      }
      if (aud.type === "status" && !aud.status) {
        toast.error("Please select a status");
        return;
      }
      if (aud.type === "score" && aud.min === "" && aud.max === "") {
        toast.error("Please provide a score range");
        return;
      }
      if (aud.type === "score" && aud.min !== "" && aud.max !== "" && Number(aud.min) > Number(aud.max)) {
        toast.error("Minimum score cannot be greater than maximum score");
        return;
      }
      if (aud.type === "segment" && !aud.savedSearchId) {
        toast.error("Please select a segment");
        return;
      }
    }

    try {
      if (!draft.schedule) {
        toast.error("Please select a campaign start date.");
        return;
      }

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

      setShowCreate(false);
      setEditingId(null);

      setDraft({
        name: "",
        audience: { type: "all" },
        schedule: "",
        steps: [
          {
            day: 0,
            subject: "",
        body: "",
          },
        ],
      });

      load();
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
    const ok = window.confirm("Delete this campaign?");
    if (!ok) return;

    try {
      await campaignService.remove(id);
      toast.success("Campaign deleted");
      load();
    } catch (err) {
      toast.error(err?.message || "Delete failed");
    }
  };
  const toggleLeads = async (campaignId) => {
  const campaign = items.find((item) => item.id === campaignId);
  const isScheduled = campaign?.conditions?.status === "scheduled" && !campaign.active;

  if (expandedId === campaignId) {
    setExpandedId(null);
    return;
  }

  setExpandedId(campaignId);

  // Scheduled campaigns already receive their latest expected-lead preview
  // from the campaign list endpoint, so do not query enrollments here.
  if (isScheduled) return;

  if (!leadsByCampaign[campaignId]) {
    setLoadingLeads(true);
    try {
      const data = await campaignService.getLeads(campaignId);
      setLeadsByCampaign((prev) => ({ ...prev, [campaignId]: data.leads || [] }));
    } catch (err) {
      toast.error(err?.message || "Failed to load leads");
    } finally {
      setLoadingLeads(false);
    }
  }
};

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
      steps: campaign.conditions?.steps || [
        {
          day: 0,
          subject: campaign.conditions?.subject || "",
          body: campaign.conditions?.body || "",
        },
      ],
    });

    setShowCreate(true);
  };

  return (
    <UptoPage>
      <UptoHero
        title="Campaigns"
        subtitle="Email and marketing automation"
        actions={<UptoButton onClick={() => setShowCreate(true)}><Plus className="mr-1 h-4 w-4 inline" /> New campaign</UptoButton>}
      />
      <UptoCard>
        {loading && <UptoSpinner />}
        {error && <UptoError message={error} onRetry={load} />}
        {!loading && !error && items.length === 0 && (
          <UptoEmptyState icon={Megaphone} title="No campaigns" body="Create a campaign to reach your audience." />
        )}
        {!loading && !error && items.length > 0 && (
          <div className="space-y-2">
            {items.map((c) => (
              <div key={c.id} className="p-3 rounded-xl border border-slate-200 dark:border-slate-700">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium">{c.name}</div>
                    <div className="text-xs text-slate-500">
                      {renderAudienceLabel(c.conditions?.audience)} ·{" "}
                      {c.conditions?.schedule ? `${new Date(c.conditions.schedule).toLocaleString()}` : "No schedule"} ·{" "}
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
                        <UptoButton variant="ghost" onClick={() => handleResume(c.id)}>
                          Resume
                        </UptoButton>
                        <UptoButton variant="secondary" onClick={() => handleStop(c.id)}>
                          Stop
                        </UptoButton>
                      </>
                    ) : c.conditions?.status === "cancelled" ? (
                      <span className="text-sm text-slate-500">Stopped</span>
                    ) : c.conditions?.status === "completed" ? (
                      <span className="text-sm text-slate-500">Completed</span>
                    ) : !c.active && c.conditions?.status === "scheduled" ? (
                      <span className="text-sm text-slate-500">Waiting for schedule</span>
                    ) : c.conditions?.status === "error" ? (
                      <span className="text-sm text-amber-600 dark:text-amber-400">
                        Configuration error — edit and reschedule
                      </span>
                    ) : !c.active ? (
                      <UptoButton variant="ghost" onClick={() => handleLaunch(c.id)}>
                        Schedule
                      </UptoButton>
                    ) : (
                      <>
                        <UptoButton variant="secondary" onClick={() => handlePause(c.id)}>
                          Pause
                        </UptoButton>
                        <UptoButton variant="secondary" onClick={() => handleStop(c.id)}>
                          Stop
                        </UptoButton>
                      </>
                    )}

                    <UptoButton variant="ghost" onClick={() => toggleLeads(c.id)}>
                      {c.conditions?.status === "scheduled" && !c.active
                        ? (expandedId === c.id ? "Hide Expected Leads" : "View Expected Leads")
                        : (expandedId === c.id ? "Hide Leads" : "View Leads")}
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

                {c.conditions?.status === "error" && c.conditions?.lastError && (
                  <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-950/20 p-3 text-xs">
                    <div className="font-semibold text-amber-800 dark:text-amber-300">Campaign activation error</div>
                    <div className="mt-1 text-amber-700 dark:text-amber-400">{c.conditions.lastError}</div>
                  </div>
                )}

                {expandedId === c.id && c.conditions?.status === "scheduled" && !c.active && (
                  <div className="mt-3 rounded-lg bg-slate-50 dark:bg-slate-800/60 p-3">
                    <div className="text-xs font-semibold text-slate-600 dark:text-slate-300 mb-2">
                      Expected leads
                    </div>
                    {c.expectedLeadsPreview?.length ? (
                      <div className="space-y-2">
                        {c.expectedLeadsPreview.map((lead) => (
                          <div key={lead.id} className="grid grid-cols-1 sm:grid-cols-4 gap-1 text-xs">
                            <span className="font-medium">{lead.name || "—"}</span>
                            <span>{lead.email || "—"}</span>
                            <span>{lead.companyName || "—"}</span>
                            <UptoBadge>{lead.status || "—"}</UptoBadge>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-xs text-slate-500">No matching leads currently.</div>
                    )}
                  </div>
                )}

                {expandedId === c.id && !(c.conditions?.status === "scheduled" && !c.active) && (
                  <div className="mt-3 pt-3 border-t border-slate-200 dark:border-slate-700">
                    {loadingLeads ? (
                      <UptoSpinner />
                    ) : (leadsByCampaign[c.id]?.length ? (
                      <div className="space-y-1">
                        {leadsByCampaign[c.id].map((l) => (
                          <div key={l.enrollmentId} className="flex items-center justify-between text-xs py-1">
                            <span>{l.name || "—"} · {l.email}</span>
                            <span className="text-slate-500">{l.companyName || "—"}</span>
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
                      <div className="text-xs text-slate-500">No leads enrolled yet.</div>
                    ))}
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
              <UptoInput label="Name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} required />

              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Target Audience</label>
                <select
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={
                    typeof draft.audience === "string"
                      ? draft.audience === "all" ? "all" : "all"
                      : draft.audience?.type || "all"
                  }
                  onChange={(e) => handleAudienceTypeChange(e.target.value)}
                >
                  <option value="all">All Leads</option>
                  <option value="status">By Status</option>
                  <option value="tag">By Tag</option>
                  <option value="segment">By Saved Segment</option>
                  <option value="score">By Score</option>
                </select>

                {(typeof draft.audience === "object" && draft.audience?.type === "tag") && (
                  <div className="mt-2">
                    <label className="text-xs text-slate-500 mb-1 block">Select Tag</label>
                    {tags.length === 0 ? (
                      <div className="text-xs text-amber-600 dark:text-amber-400">No tags available. Please create tags first in Leads.</div>
                    ) : (
                      <select
                        className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-2 text-sm"
                        value={draft.audience?.tagId || ""}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            audience: { type: "tag", tagId: Number(e.target.value) },
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

                {(typeof draft.audience === "object" && draft.audience?.type === "score") && (
                  <div className="mt-2 space-y-2">
                    <label className="text-xs text-slate-500 mb-1 block">Score range</label>
                    <div className="grid grid-cols-2 gap-2">
                      <UptoInput
                        label="Minimum"
                        type="number"
                        min="0"
                        value={draft.audience?.min ?? ""}
                        onChange={(e) => setDraft({
                          ...draft,
                          audience: { ...draft.audience, min: e.target.value === "" ? "" : Number(e.target.value) },
                        })}
                      />
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
                    </div>
                    <div className="text-xs text-slate-500">
                      Examples: minimum 80 = Score ≥ 80; maximum 50 = Score ≤ 50; both = custom range.
                    </div>
                  </div>
                )}

                {(typeof draft.audience === "object" && draft.audience?.type === "status") && (
                  <div className="mt-2">
                    <label className="text-xs text-slate-500 mb-1 block">Select Lead Status</label>
                    <select
                      className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-2 text-sm"
                      value={draft.audience?.status || "new"}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          audience: { type: "status", status: e.target.value },
                        })
                      }
                    >
                      {LEAD_STATUS_OPTIONS.map((st) => (
                        <option key={st.value} value={st.value}>
                          {st.label}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {(typeof draft.audience === "object" && draft.audience?.type === "segment") && (
                  <div className="mt-2">
                    <label className="text-xs text-slate-500 mb-1 block">Select Saved Segment</label>
                    {segments.length === 0 ? (
                      <div className="text-xs text-amber-600 dark:text-amber-400">No lead segments saved yet.</div>
                    ) : (
                      <select
                        className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-2 text-sm"
                        value={draft.audience?.savedSearchId || ""}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            audience: { type: "segment", savedSearchId: Number(e.target.value) },
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
              </div>

              <UptoInput
                label="Campaign Start Date"
                type="date"
                min={new Date().toISOString().slice(0, 10)}
                value={(draft.schedule || "").slice(0, 10)}
                onChange={(e) => setDraft({ ...draft, schedule: e.target.value })}
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
                            day: draft.steps.length === 0
                              ? 0
                              : draft.steps[draft.steps.length - 1].day + 1,
                            subject: "",
        body: "",
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
                              steps: draft.steps.filter((_, i) => i !== index),
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
              <UptoButton type="button" variant="ghost" onClick={() => { setShowCreate(false); setEditingId(null); }}>Cancel</UptoButton>
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



