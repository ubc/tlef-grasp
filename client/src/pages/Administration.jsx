import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAppStore } from "../stores/appStore";
import { PROMPT_FIELDS } from "../lib/prompts";
import {
  useAdminPromptOverrides,
  useResetPromptForAllCourses,
} from "../hooks/useAdminPrompts";
import { useToast } from "../components/ui/Toast";
import { ConfirmModal } from "../components/ui/Modal";

const courseCount = (n) => `${n} course${n === 1 ? "" : "s"}`;

export default function Administration() {
  const showToast = useToast();
  const { prompts, isPending, isError } = useAdminPromptOverrides();
  const [confirmField, setConfirmField] = useState(null);
  const navigate = useNavigate();
  const selectedCourse = useAppStore((state) => state.selectedCourse);

  useEffect(() => {
    document.title = "GRASP - Administration";
  }, []);

  const resetMutation = useResetPromptForAllCourses({
    onSuccess: (data) => {
      const field = PROMPT_FIELDS.find((f) => f.key === data.promptKey);
      showToast(
        `${field?.label || "Prompt"} reset to default in ${courseCount(data.resetCourses)}`,
        "success"
      );
    },
    onError: (error) => showToast(error.message || "Failed to reset the prompt", "error"),
  });

  return (
    // Framed like onboarding rather than inside the course shell: everything
    // here applies to every course, not the selected one.
    <div className="min-h-screen bg-gradient-to-br from-[#667eea] to-[#764ba2] px-4 py-10">
      <div className="mx-auto w-full max-w-4xl">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-2xl font-bold text-white">Administration</h1>
          <div className="flex flex-wrap gap-2">
            {selectedCourse && (
              <button
                type="button"
                onClick={() => navigate("/dashboard")}
                className="inline-flex items-center gap-2 rounded-lg bg-white/20 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-white/30"
              >
                <i className="fas fa-arrow-left" />
                Back to Dashboard
              </button>
            )}
            <button
              type="button"
              onClick={() => navigate("/onboarding")}
              className="inline-flex items-center gap-2 rounded-lg bg-white/20 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-white/30"
            >
              <i className="fas fa-th-large" />
              All courses
            </button>
          </div>
        </div>

        <section className="rounded-[20px] bg-white p-6 shadow-[0_20px_40px_rgba(0,0,0,0.1)] sm:p-10">
          <h2 className="text-lg font-semibold text-ink">Course prompts</h2>
          <p className="mt-1 mb-6 text-sm text-muted">
            A course that has saved its settings keeps its own copy of every prompt, so
            it does not pick up a change to the default. Resetting a prompt here removes
            that copy from every course, archived ones included, and they all use the
            current default from then on. Prompts an instructor customized are reset too.
          </p>

          {isError && (
            <p className="mb-4 text-sm text-danger">Could not load how many courses store each prompt.</p>
          )}

          <ul className="divide-y divide-gray-200">
            {PROMPT_FIELDS.map((field) => {
              const counts = prompts[field.key];
              const stored = counts?.courses || 0;
              const outdated = stored - (counts?.matchingDefault || 0);
              const resetting = resetMutation.isPending && resetMutation.variables === field.key;
              return (
                <li
                  key={field.key}
                  className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <p className="font-semibold text-ink">{field.label}</p>
                    <p className="text-sm text-muted">
                      {isPending
                        ? "Counting courses…"
                        : stored === 0
                          ? "Every course uses the default."
                          : `${courseCount(stored)} store their own copy` +
                            (outdated > 0 ? ` — ${outdated} differ from the default.` : ", all matching the default.")}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setConfirmField(field)}
                    disabled={isPending || stored === 0 || resetMutation.isPending}
                    className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-danger/40 bg-white px-4 py-2 text-sm font-medium text-danger transition-colors hover:bg-danger/5 disabled:opacity-60"
                  >
                    <i className={`fas ${resetting ? "fa-spinner fa-spin" : "fa-undo"}`} />
                    Reset in every course
                  </button>
                </li>
              );
            })}
          </ul>
        </section>

        <ConfirmModal
          open={!!confirmField}
          onClose={() => setConfirmField(null)}
          onConfirm={() => resetMutation.mutate(confirmField.key)}
          title="Reset prompt in every course?"
          message={
            confirmField
              ? `${confirmField.label} will go back to the default in ${courseCount(
                  prompts[confirmField.key]?.courses || 0
                )}, replacing any changes instructors made to it. This cannot be undone.`
              : ""
          }
          confirmLabel="Reset in every course"
          danger
        />
      </div>
    </div>
  );
}
