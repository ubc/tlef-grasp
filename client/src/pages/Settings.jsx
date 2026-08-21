import { useEffect, useState } from "react";
import { useSelectedCourseId } from "../stores/appStore";
import {
  useCourseSettings,
  useSettingsDefaults,
  useEnrollmentCode,
  useSaveCourseSettings,
  useRegenerateEnrollmentCode,
} from "../hooks/useCourseSettings";
import { useCoInstructorAccess } from "../hooks/useCoInstructorAccess";
import { useCanvasStatus } from "../hooks/useCanvasIntegration";
import { useMoodleStatus } from "../hooks/useMoodleIntegration";
import { useToast } from "../components/ui/Toast";
import { ConfirmModal } from "../components/ui/Modal";
import {
  CanvasConnectionPanel,
  MoodleConnectionPanel,
} from "../components/lms/LmsConnectionPanels";
import { CO_INSTRUCTOR_PERMISSIONS } from "../lib/permissions";
import {
  QUESTION_TYPES,
  DEFAULT_BLOOM_TYPE_PREFERENCES,
  BLOOM_LEVELS,
} from "../lib/constants";
import { BLOOM_BADGE_COLORS } from "../lib/bloom";

const TYPE_LABELS = {
  [QUESTION_TYPES.MULTIPLE_CHOICE]: "Multiple Choice",
  [QUESTION_TYPES.FILL_IN_THE_BLANK]: "Fill-in-the-blank",
  [QUESTION_TYPES.CALCULATION]: "Calculation",
  [QUESTION_TYPES.OPEN_ENDED]: "Open-ended",
};

// Pipeline stages a course owner can tune, keyed to the server's
// OPERATION_GROUPS so the labels match what the usage report prints.
const GENERATION_STAGES = [
  {
    key: "question-generation",
    label: "Question generation",
    description: "Writing each question from the retrieved course material.",
  },
  {
    key: "question-review-fix",
    label: "Question review and fix",
    description:
      "Checking each generated question, and repairing flagged ones when automatic fixing is on.",
  },
  {
    key: "answer-grading",
    label: "Answer grading",
    description: "Grading open-ended and fill-in-the-blank answers students submit.",
  },
  {
    key: "objective-generation",
    label: "Learning objective generation",
    description: "Deriving objectives from the material attached to a course.",
  },
  {
    key: "outline-generation",
    label: "Outline generation",
    description: "Summarizing a material into the outline shown on its card.",
  },
  {
    key: "document-parsing",
    label: "Document parsing",
    description: "Transcribing images and diagrams found in PDFs and slide decks.",
  },
];

// "" means the course expresses no preference and the deployment default
// applies. The server accepts more values than this; these are the useful ones.
const EFFORT_OPTIONS = [
  { value: "", label: "Default" },
  { value: "low", label: "Low — fastest, cheapest" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High — slowest, most thorough" },
];

const buildEffortState = (source = {}) =>
  Object.fromEntries(
    GENERATION_STAGES.map((stage) => [
      stage.key,
      EFFORT_OPTIONS.some((option) => option.value === source[stage.key])
        ? source[stage.key]
        : "",
    ])
  );

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
  {
    key: "powerPointImageDescription",
    label: "PowerPoint Image Extraction Prompt",
    rows: 8,
    description:
      "Used when PowerPoint uploads contain embedded images, charts, screenshots, or diagrams that need vision-model descriptions.",
    variables: [
      ["{slideNumber}", "The slide number containing the embedded image."],
      ["{fileName}", "The embedded image filename from the PowerPoint archive, when available."],
    ],
  },
  {
    key: "openEndedGrading",
    label: "Open-Ended Answer Grading Prompt",
    rows: 12,
    description:
      "Used when the AI grades a student's open-ended answer against the question's grading criteria and sample answer. Returns a pass/fail verdict with per-criterion feedback; instructors can override the grade in Quiz Scores.",
    variables: [
      ["{question}", "The open-ended question shown to the student."],
      ["{studentAnswer}", "The student's submitted answer."],
      ["{gradingCriteria}", "The grading criteria/rubric from the question."],
      ["{sampleAnswer}", "The sample strong answer from the question."],
    ],
  },
  {
    key: "fillInTheBlankGrading",
    label: "Fill-in-the-Blank Fallback Grading Prompt",
    rows: 12,
    description:
      "Used only when a fill-in-the-blank answer does not exactly match an accepted answer. The AI decides whether the answer is equivalent (synonym, alternate notation) and writes brief feedback; it can only upgrade an answer to correct, never downgrade an exact match.",
    variables: [
      ["{question}", "The fill-in-the-blank question with its blank."],
      ["{studentAnswer}", "The student's submitted answer."],
      ["{correctAnswer}", "The canonical correct answer."],
      ["{acceptableAnswers}", "Instructor-provided acceptable alternatives."],
    ],
  },
];

const secondaryBtnClass =
  "inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-gray-50 disabled:opacity-60";

const buildPromptState = (source = {}) =>
  Object.fromEntries(PROMPT_FIELDS.map((field) => [field.key, source[field.key] || ""]));

export default function Settings() {
  const showToast = useToast();
  const courseId = useSelectedCourseId();
  const canvasReturnState = new URLSearchParams(window.location.search).get("canvas");
  const openMoodleSettings = new URLSearchParams(window.location.search).has("moodle");

  const [activeTab, setActiveTab] = useState(
    canvasReturnState ? "canvas" : openMoodleSettings ? "moodle" : "general"
  );
  const [bloomPrimary, setBloomPrimary] = useState(() =>
    Object.fromEntries(
      BLOOM_LEVELS.map((level) => [level, DEFAULT_BLOOM_TYPE_PREFERENCES[level][0]])
    )
  );
  const [prompts, setPrompts] = useState(() => buildPromptState());
  // Co-instructor permission toggles (owner only). Default every feature to
  // enabled; the stored map only carries explicit restrictions.
  const [coInstructorPerms, setCoInstructorPerms] = useState(() =>
    Object.fromEntries(CO_INSTRUCTOR_PERMISSIONS.map((perm) => [perm.key, true]))
  );
  // Generation controls (owner only). Empty effort means "use the deployment
  // default"; the automatic fix runs unless the owner turns it off.
  const [reasoningEffort, setReasoningEffort] = useState(() => buildEffortState());
  const [autoFixEnabled, setAutoFixEnabled] = useState(true);

  const { isOwner } = useCoInstructorAccess();
  const { settings } = useCourseSettings(courseId);
  const { defaults } = useSettingsDefaults();
  const defaultPrompts = defaults?.prompts || {};
  const codeQuery = useEnrollmentCode(courseId);
  const enrollmentCode = codeQuery.enrollmentCode;
  const canvasStatus = useCanvasStatus();
  const moodleStatus = useMoodleStatus();
  const showCanvasIntegration = canvasStatus.configured || canvasStatus.isError;
  const showMoodleIntegration = moodleStatus.configured || moodleStatus.isError;

  useEffect(() => {
    if (!canvasStatus.isPending && !showCanvasIntegration && activeTab === "canvas") {
      setActiveTab("general");
    }
  }, [activeTab, canvasStatus.isPending, showCanvasIntegration]);

  useEffect(() => {
    if (!moodleStatus.isPending && !showMoodleIntegration && activeTab === "moodle") {
      setActiveTab("general");
    }
  }, [activeTab, moodleStatus.isPending, showMoodleIntegration]);

  // Hydrate the form when settings arrive
  useEffect(() => {
    if (!settings) return;
    if (settings.prompts) {
      setPrompts(buildPromptState(settings.prompts));
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
    setReasoningEffort(buildEffortState(settings.reasoningEffort));
    setAutoFixEnabled(settings.autoFixEnabled !== false);
    if (settings.coInstructorPermissions) {
      setCoInstructorPerms(() =>
        Object.fromEntries(
          CO_INSTRUCTOR_PERMISSIONS.map((perm) => [
            perm.key,
            settings.coInstructorPermissions[perm.key] !== false,
          ])
        )
      );
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
    saveMutation.mutate({
      prompts,
      bloomTypePreferences,
      // Only the owner may change co-instructor permissions or the generation
      // controls; the server strips them from a non-owner's update regardless.
      ...(isOwner
        ? {
            coInstructorPermissions: coInstructorPerms,
            // Drop the stages left on "Default" so an unset stage keeps
            // following the deployment configuration.
            reasoningEffort: Object.fromEntries(
              Object.entries(reasoningEffort).filter(([, effort]) => effort)
            ),
            autoFixEnabled,
          }
        : {}),
    });
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

  const tabs = [
    { id: "general", icon: "fa-cog", label: "Course Settings" },
    { id: "prompt", icon: "fa-terminal", label: "Course Prompts" },
    ...(showCanvasIntegration
      ? [{ id: "canvas", icon: "fa-chalkboard-teacher", label: "Canvas LMS" }]
      : []),
    ...(showMoodleIntegration
      ? [{ id: "moodle", icon: "fa-graduation-cap", label: "Moodle LMS" }]
      : []),
    // Owner-only: control what co-instructors can access in this course.
    ...(isOwner
      ? [
          { id: "generation", icon: "fa-wand-magic-sparkles", label: "AI Generation" },
          { id: "permissions", icon: "fa-user-shield", label: "Co-Instructor Permissions" },
        ]
      : []),
  ];

  const toggleCoInstructorPerm = (key) =>
    setCoInstructorPerms((prev) => ({ ...prev, [key]: !prev[key] }));

  // Defaults grant co-instructors full access: every permission enabled.
  const coInstructorPermsAtDefault = CO_INSTRUCTOR_PERMISSIONS.every(
    (perm) => coInstructorPerms[perm.key] !== false
  );

  // Default state: every stage deferring to the deployment, review-fix running.
  const generationAtDefault =
    autoFixEnabled && GENERATION_STAGES.every((stage) => !reasoningEffort[stage.key]);

  const handleResetGeneration = () => {
    setReasoningEffort(buildEffortState());
    setAutoFixEnabled(true);
    showToast(
      "AI generation settings restored to defaults — click Save All Changes to apply.",
      "info"
    );
  };

  const handleResetCoInstructorPerms = () => {
    setCoInstructorPerms(
      Object.fromEntries(CO_INSTRUCTOR_PERMISSIONS.map((perm) => [perm.key, true]))
    );
    showToast(
      "Co-instructor permissions restored to defaults — click Save All Changes to apply.",
      "info"
    );
  };

  return (
    <div className="mx-auto max-w-5xl p-4 md:p-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-ink">Settings</h1>
        {!["canvas", "moodle"].includes(activeTab) && (
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
        )}
      </div>

      {/* Tabs */}
      <div className="mb-6 flex gap-2 border-b border-gray-200">
        {tabs.map((tab) => (
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
                        aria-label={`Default question type for ${level}`}
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

      {activeTab === "generation" && isOwner && (
        <section className="rounded-2xl bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-ink">AI Generation</h2>
          <p className="mt-1 mb-6 text-sm text-muted">
            Control how much the AI thinks before answering, and whether generated
            questions are reviewed. Higher effort produces better output but takes
            longer and costs more. Stages left on{" "}
            <span className="font-semibold text-ink">Default</span> follow this
            installation&rsquo;s configuration. Click{" "}
            <span className="font-semibold text-ink">Save All Changes</span> to apply.
          </p>

          <div className="divide-y divide-gray-100">
            <div className="flex items-center justify-between gap-4 pb-4">
              <div className="flex items-start gap-3">
                <i className="fas fa-clipboard-check mt-0.5 w-5 text-center text-muted" />
                <div>
                  <p className="text-sm font-medium text-ink">
                    Automatically fix flagged questions
                  </p>
                  <p className="text-xs text-muted">
                    Every generated question is reviewed either way. With this on, the
                    AI also rewrites the ones it flags and re-reviews them. Turning it
                    off is faster and cheaper: flagged questions come back flagged,
                    with the reviewer&rsquo;s reason, for you to fix or discard.
                  </p>
                </div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={autoFixEnabled}
                aria-label="Automatically fix flagged questions"
                onClick={() => setAutoFixEnabled((prev) => !prev)}
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none ${
                  autoFixEnabled ? "bg-primary" : "bg-gray-200"
                }`}
              >
                <span
                  className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                    autoFixEnabled ? "translate-x-5" : "translate-x-0"
                  }`}
                />
              </button>
            </div>

            {GENERATION_STAGES.map((stage) => (
              <div
                key={stage.key}
                className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <p className="text-sm font-medium text-ink">{stage.label}</p>
                  <p className="text-xs text-muted">{stage.description}</p>
                </div>
                <select
                  aria-label={`Reasoning effort for ${stage.label}`}
                  value={reasoningEffort[stage.key] ?? ""}
                  onChange={(event) =>
                    setReasoningEffort((prev) => ({
                      ...prev,
                      [stage.key]: event.target.value,
                    }))
                  }
                  className="w-full shrink-0 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-ink focus:border-primary focus:outline-none sm:w-64"
                >
                  {EFFORT_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>

          <div className="mt-4">
            <button
              type="button"
              onClick={handleResetGeneration}
              disabled={generationAtDefault}
              className={`${secondaryBtnClass} disabled:cursor-not-allowed disabled:opacity-50`}
            >
              <i className="fas fa-undo" /> Reset to Defaults
            </button>
          </div>
        </section>
      )}

      {activeTab === "permissions" && isOwner && (
        <section className="rounded-2xl bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-ink">Co-Instructor Permissions</h2>
          <p className="mt-1 mb-6 text-sm text-muted">
            Choose what co-instructors (faculty who joined this course with the invite
            code) can access. You and app administrators always have full access.
            Dashboard, My Sections, Quizzes, and Quiz Scores are always available;
            scheduling quizzes is always allowed. Click{" "}
            <span className="font-semibold text-ink">Save All Changes</span> to apply.
          </p>

          <div className="divide-y divide-gray-100">
            {CO_INSTRUCTOR_PERMISSIONS.map((perm) => {
              const enabled = coInstructorPerms[perm.key] !== false;
              return (
                <div key={perm.key} className="flex items-center justify-between gap-4 py-4">
                  <div className="flex items-start gap-3">
                    <i className={`fas ${perm.icon} mt-0.5 w-5 text-center text-muted`} />
                    <div>
                      <p className="text-sm font-medium text-ink">{perm.label}</p>
                      <p className="text-xs text-muted">{perm.description}</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={enabled}
                    aria-label={`Allow co-instructors: ${perm.label}`}
                    onClick={() => toggleCoInstructorPerm(perm.key)}
                    className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none ${
                      enabled ? "bg-primary" : "bg-gray-200"
                    }`}
                  >
                    <span
                      className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                        enabled ? "translate-x-5" : "translate-x-0"
                      }`}
                    />
                  </button>
                </div>
              );
            })}
          </div>

          <div className="mt-4">
            <button
              type="button"
              onClick={handleResetCoInstructorPerms}
              disabled={coInstructorPermsAtDefault}
              className={`${secondaryBtnClass} disabled:cursor-not-allowed disabled:opacity-50`}
            >
              <i className="fas fa-undo" /> Reset to Defaults
            </button>
          </div>
        </section>
      )}

      {activeTab === "canvas" && showCanvasIntegration && (
        <CanvasConnectionPanel
          status={canvasStatus}
          returnState={canvasReturnState}
        />
      )}

      {activeTab === "moodle" && showMoodleIntegration && (
        <MoodleConnectionPanel status={moodleStatus} />
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
