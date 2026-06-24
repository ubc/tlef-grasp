import { useEffect, useState } from "react";
import { useSelectedCourseId } from "../stores/appStore";
import {
  useCourseSettings,
  useSettingsDefaults,
  useEnrollmentCode,
  useSaveCourseSettings,
  useRegenerateEnrollmentCode,
} from "../hooks/useCourseSettings";
import { useToast } from "../components/ui/Toast";
import { ConfirmModal } from "../components/ui/Modal";
import {
  QUESTION_TYPES,
  DEFAULT_BLOOM_TYPE_PREFERENCES,
  BLOOM_LEVELS,
} from "../lib/constants";

const TYPE_LABELS = {
  [QUESTION_TYPES.MULTIPLE_CHOICE]: "Multiple Choice",
  [QUESTION_TYPES.FILL_IN_THE_BLANK]: "Fill-in-the-blank",
  [QUESTION_TYPES.CALCULATION]: "Calculation",
  [QUESTION_TYPES.OPEN_ENDED]: "Open-ended",
};

const BLOOM_BADGE_COLORS = {
  Remember: "bg-blue-100 text-blue-700",
  Understand: "bg-green-100 text-green-700",
  Apply: "bg-yellow-100 text-yellow-700",
  Analyze: "bg-orange-100 text-orange-700",
  Evaluate: "bg-purple-100 text-purple-700",
  Create: "bg-pink-100 text-pink-700",
};

const PROMPT_FIELDS = [
  {
    key: "questionGeneration",
    label: "Question Generation Prompt",
    rows: 15,
    description:
      "Handles the creation of multiple-choice questions based on selected objectives.",
    variables: [
      ["{learningObjectiveText}", "The text of the parent learning objective."],
      ["{granularLearningObjectiveText}", "The specific sub-objective text."],
      ["{bloomLevel}", "The targeted Bloom's Taxonomy level(s)."],
      ["{questionType}", "The type of question to generate."],
      ["{ragContext}", "Relevant educational content retrieved from course materials."],
    ],
  },
  {
    key: "objectiveGenerationAuto",
    label: "Learning Objective Generation Prompt - Auto Mode",
    rows: 12,
    description:
      "Used when the AI generates a set of course learning objectives from scratch based on processed materials.",
    variables: [
      ["{courseName}", "The name of the current course."],
      ["{ragContext}", "Comprehensive content extracted from all selected materials."],
    ],
  },
  {
    key: "objectiveGenerationManual",
    label: "Learning Objective Generation Prompt - Manual Mode",
    rows: 12,
    description:
      "Used when you provide specific main objectives and want the AI to generate detailed sub-objectives and taxonomy levels for them.",
    variables: [
      ["{courseName}", "The name of the current course."],
      ["{userObjectivesList}", "The list of main objectives you provided."],
      ["{ragContext}", "Relevant content from materials to support sub-objective generation."],
    ],
  },
];

const secondaryBtnClass =
  "inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-gray-50 disabled:opacity-60";

export default function Settings() {
  const showToast = useToast();
  const courseId = useSelectedCourseId();

  const [activeTab, setActiveTab] = useState("general");
  const [bloomPrimary, setBloomPrimary] = useState(() =>
    Object.fromEntries(
      BLOOM_LEVELS.map((level) => [level, DEFAULT_BLOOM_TYPE_PREFERENCES[level][0]])
    )
  );
  const [prompts, setPrompts] = useState({
    questionGeneration: "",
    objectiveGenerationAuto: "",
    objectiveGenerationManual: "",
  });

  const { settings } = useCourseSettings(courseId);
  const { defaults } = useSettingsDefaults();
  const defaultPrompts = defaults?.prompts || {};
  const codeQuery = useEnrollmentCode(courseId);
  const enrollmentCode = codeQuery.enrollmentCode;

  // Hydrate the form when settings arrive
  useEffect(() => {
    if (!settings) return;
    if (settings.prompts) {
      setPrompts({
        questionGeneration: settings.prompts.questionGeneration || "",
        objectiveGenerationAuto: settings.prompts.objectiveGenerationAuto || "",
        objectiveGenerationManual: settings.prompts.objectiveGenerationManual || "",
      });
    }
    if (settings.bloomTypePreferences) {
      setBloomPrimary((prev) => {
        const next = { ...prev };
        for (const level of BLOOM_LEVELS) {
          const prefs = settings.bloomTypePreferences[level];
          if (prefs && prefs.length > 0) next[level] = prefs[0];
        }
        return next;
      });
    }
  }, [settings]);

  const saveMutation = useSaveCourseSettings(courseId, {
    onSuccess: () => showToast("Settings saved successfully", "success"),
    onError: (error) => showToast(error.message || "Error saving settings", "error"),
  });

  const regenerateMutation = useRegenerateEnrollmentCode(courseId, {
    onSuccess: (data) =>
      showToast(data.message || "Invite code regenerated", "success"),
    onError: (error) =>
      showToast(error.message || "Failed to regenerate code", "error"),
  });

  const handleSave = () => {
    if (!courseId) {
      showToast("No course selected. Please select a course first.", "error");
      return;
    }
    // Primary first, then the default fallbacks minus the primary
    const bloomTypePreferences = Object.fromEntries(
      BLOOM_LEVELS.map((level) => {
        const primary = bloomPrimary[level];
        const rest = DEFAULT_BLOOM_TYPE_PREFERENCES[level].filter(
          (type) => type !== primary
        );
        return [level, [primary, ...rest]];
      })
    );
    saveMutation.mutate({ prompts, bloomTypePreferences });
  };

  const handleResetBloom = () => {
    setBloomPrimary(
      Object.fromEntries(
        BLOOM_LEVELS.map((level) => [level, DEFAULT_BLOOM_TYPE_PREFERENCES[level][0]])
      )
    );
    showToast("Bloom defaults restored — click Save All Changes to apply.", "info");
  };

  const handleCopyCode = async () => {
    if (!enrollmentCode) {
      showToast("No code to copy", "warning");
      return;
    }
    try {
      await navigator.clipboard.writeText(enrollmentCode);
      showToast("Code copied to clipboard", "success");
    } catch {
      showToast("Could not copy code", "error");
    }
  };

  const [confirmRegenerate, setConfirmRegenerate] = useState(false);

  return (
    <div className="mx-auto max-w-5xl p-4 md:p-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-ink">Settings</h1>
        <button
          type="button"
          onClick={handleSave}
          disabled={saveMutation.isPending}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 font-medium text-white transition-colors hover:bg-primary-dark disabled:opacity-60"
        >
          {saveMutation.isPending ? (
            <>
              <i className="fas fa-spinner fa-spin" /> Saving...
            </>
          ) : (
            <>
              <i className="fas fa-save" /> Save All Changes
            </>
          )}
        </button>
      </div>

      {/* Tabs */}
      <div className="mb-6 flex gap-2 border-b border-gray-200">
        {[
          { id: "general", icon: "fa-cog", label: "Course Settings" },
          { id: "prompt", icon: "fa-terminal", label: "Course Prompts" },
        ].map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`-mb-px inline-flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium transition-colors ${
              activeTab === tab.id
                ? "border-primary text-primary"
                : "border-transparent text-muted hover:text-ink"
            }`}
          >
            <i className={`fas ${tab.icon}`} /> {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "general" && (
        <div className="space-y-8">
          <section className="rounded-2xl bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-ink">
              Question Type by Bloom Level
            </h2>
            <p className="mt-1 mb-5 text-sm text-muted">
              Set the primary question type generated for each Bloom's Taxonomy level.
              Changes apply to this course only. The default mapping is used when no
              override is set.
            </p>

            <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] text-left text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-muted">
                  <th className="py-2 pr-4 font-semibold">Bloom's Level</th>
                  <th className="py-2 pr-4 font-semibold">Primary Question Type</th>
                  <th className="py-2 font-semibold">Default</th>
                </tr>
              </thead>
              <tbody>
                {BLOOM_LEVELS.map((level) => (
                  <tr key={level} className="border-b border-gray-100">
                    <td className="py-3 pr-4">
                      <span
                        className={`rounded-full px-3 py-1 text-xs font-semibold ${BLOOM_BADGE_COLORS[level]}`}
                      >
                        {level}
                      </span>
                    </td>
                    <td className="py-3 pr-4">
                      <select
                        value={bloomPrimary[level]}
                        onChange={(event) =>
                          setBloomPrimary((prev) => ({
                            ...prev,
                            [level]: event.target.value,
                          }))
                        }
                        className="w-full max-w-xs rounded-lg border border-gray-300 bg-white px-3 py-2 text-ink focus:border-primary focus:outline-none"
                      >
                        {Object.values(QUESTION_TYPES).map((type) => (
                          <option key={type} value={type}>
                            {TYPE_LABELS[type]}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="py-3 text-muted">
                      {TYPE_LABELS[DEFAULT_BLOOM_TYPE_PREFERENCES[level][0]]}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>

            <div className="mt-4">
              <button type="button" onClick={handleResetBloom} className={secondaryBtnClass}>
                <i className="fas fa-undo" /> Reset to Defaults
              </button>
            </div>
          </section>

          <section className="rounded-2xl bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-ink">Course invite code</h2>
            <p className="mt-1 mb-5 text-sm text-muted">
              Share this code with other faculty, staff, or administrators so they can
              join this course from{" "}
              <strong className="text-ink">Onboarding → Join a course</strong> and access
              its dashboard.
            </p>

            <label
              htmlFor="enrollment-code-display"
              className="mb-2 block text-sm font-semibold text-ink"
            >
              Current invite code
            </label>
            <div className="flex max-w-md gap-2">
              <input
                id="enrollment-code-display"
                type="text"
                readOnly
                value={enrollmentCode}
                placeholder={
                  !courseId
                    ? "No course selected"
                    : codeQuery.isPending
                      ? "Loading…"
                      : codeQuery.isError
                        ? "Could not load code"
                        : ""
                }
                className="flex-1 rounded-lg border border-gray-300 bg-gray-50 px-3 py-2 font-mono text-ink focus:outline-none"
              />
              <button type="button" onClick={handleCopyCode} className={secondaryBtnClass} title="Copy code">
                <i className="fas fa-copy" /> Copy
              </button>
            </div>

            <button
              type="button"
              onClick={() => setConfirmRegenerate(true)}
              disabled={regenerateMutation.isPending}
              className={`${secondaryBtnClass} mt-4 border-danger/40 text-danger hover:bg-danger/5`}
            >
              <i className="fas fa-sync-alt" /> Regenerate code
            </button>
            <p className="mt-2 flex items-start gap-2 text-xs text-muted">
              <i className="fas fa-exclamation-triangle mt-0.5 text-warning" />
              Regenerating invalidates the previous code. Students who still have the
              old code will need the new one.
            </p>
          </section>
        </div>
      )}

      {activeTab === "prompt" && (
        <section className="rounded-2xl bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-ink">LLM Prompts</h2>
          <p className="mt-1 mb-6 text-sm text-muted">
            Configure the system prompts used for generating content and questions. Use
            placeholders like{" "}
            <code className="rounded bg-gray-100 px-1.5 py-0.5 text-xs">
              {"{learningObjectiveText}"}
            </code>{" "}
            where dynamic content should be inserted.
          </p>

          <div className="space-y-8">
            {PROMPT_FIELDS.map((field) => (
              <div key={field.key}>
                <div className="mb-2 flex items-center justify-between">
                  <label
                    htmlFor={`prompt-${field.key}`}
                    className="font-semibold text-ink"
                  >
                    {field.label}
                  </label>
                  <button
                    type="button"
                    title="Reset to default"
                    onClick={() => {
                      if (defaultPrompts[field.key]) {
                        setPrompts((prev) => ({
                          ...prev,
                          [field.key]: defaultPrompts[field.key],
                        }));
                        showToast("Prompt reset to default", "info");
                      }
                    }}
                    className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
                  >
                    <i className="fas fa-undo" /> Reset to Default
                  </button>
                </div>
                <textarea
                  id={`prompt-${field.key}`}
                  rows={field.rows}
                  value={prompts[field.key]}
                  onChange={(event) =>
                    setPrompts((prev) => ({ ...prev, [field.key]: event.target.value }))
                  }
                  className="w-full rounded-lg border border-gray-300 p-3 font-mono text-sm text-ink focus:border-primary focus:outline-none"
                />
                <div className="mt-2 space-y-1 text-xs text-muted">
                  <p>{field.description}</p>
                  <p className="font-semibold text-ink">Available Variables:</p>
                  <ul className="list-disc space-y-0.5 pl-5">
                    {field.variables.map(([variable, description]) => (
                      <li key={variable}>
                        <code className="rounded bg-gray-100 px-1 py-0.5">{variable}</code>
                        : {description}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <ConfirmModal
        open={confirmRegenerate}
        onClose={() => setConfirmRegenerate(false)}
        onConfirm={() => regenerateMutation.mutate()}
        title="Regenerate Invite Code"
        message="Regenerate the invite code? The old code will stop working."
        confirmLabel="Regenerate"
        danger
      />
    </div>
  );
}
