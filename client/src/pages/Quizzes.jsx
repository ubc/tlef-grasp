import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useAppStore } from "../stores/appStore";
import { useToast } from "../components/ui/Toast";
import Modal, { ConfirmModal } from "../components/ui/Modal";
import DeliveryFormatToggle from "../components/DeliveryFormatToggle";

const toStringId = (id) => (id == null ? "" : String(id));
const getObjectId = (obj) => (obj ? toStringId(obj._id || obj.id) : "");

// Format a date for a datetime-local input (YYYY-MM-DDThh:mm, local time)
function toDatetimeLocal(dateString) {
  if (!dateString) return "";
  const date = new Date(dateString);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
}

function materialTypeMeta(fileType = "") {
  if (fileType.includes("pdf")) return { icon: "fa-file-pdf", label: "PDF", classes: "bg-red-100 text-red-600" };
  if (fileType.includes("text")) return { icon: "fa-file-alt", label: "TextBook", classes: "bg-blue-100 text-blue-600" };
  if (fileType.includes("word")) return { icon: "fa-file-word", label: "WordDocument", classes: "bg-indigo-100 text-indigo-600" };
  if (fileType.includes("link")) return { icon: "fa-link", label: "Link", classes: "bg-green-100 text-green-600" };
  return { icon: "fa-file", label: "File", classes: "bg-gray-100 text-gray-600" };
}

function QuizCard({ quiz, onUpdate, onReview, onExport, onDelete }) {
  const totalQuestions = quiz.questions.length;
  const approvedQuestions = quiz.questions.filter((q) => q.status === "Approved").length;
  const progress = totalQuestions > 0 ? (approvedQuestions / totalQuestions) * 100 : 0;
  const deliveryFormat =
    quiz.deliveryFormat === "spaced-3phase" ? "spaced-3phase" : "all-approved";

  return (
    <div className="rounded-2xl bg-white p-6 shadow-sm">
      <div className="mb-4">
        <h3 className="text-lg font-semibold text-ink">{quiz.name}</h3>
        <div className="text-xs text-muted">
          Created:{" "}
          {new Date(quiz.createdAt).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
          })}
        </div>
      </div>

      <div className="mb-4">
        <div className="h-2 overflow-hidden rounded-full bg-gray-100">
          <div
            className="h-full rounded-full bg-success transition-all"
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="mt-1 text-xs text-muted">{Math.round(progress)}% Approved</div>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-xs font-semibold text-muted">
            Release Date
          </label>
          <input
            type="datetime-local"
            defaultValue={toDatetimeLocal(quiz.releaseDate)}
            onChange={(event) => onUpdate(quiz.id, { releaseDate: event.target.value || null })}
            className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm focus:border-primary focus:outline-none"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-muted">
            Expire Date
          </label>
          <input
            type="datetime-local"
            defaultValue={toDatetimeLocal(quiz.expireDate)}
            onChange={(event) => onUpdate(quiz.id, { expireDate: event.target.value || null })}
            className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm focus:border-primary focus:outline-none"
          />
        </div>
      </div>

      <div className="mb-5">
        <label className="mb-1 block text-xs font-semibold text-muted">
          Delivery Format
        </label>
        <DeliveryFormatToggle
          value={deliveryFormat}
          onChange={(value) => {
            if (value !== deliveryFormat) {
              onUpdate(quiz.id, { deliveryFormat: value }, "Delivery format updated");
            }
          }}
        />
      </div>

      <div className="space-y-2">
        <div className="grid grid-cols-3 gap-2">
          <button
            type="button"
            onClick={() => onReview(quiz.id)}
            className="rounded-lg bg-primary px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-dark"
          >
            Review
          </button>
          <button
            type="button"
            onClick={() => onExport(quiz)}
            className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-ink transition-colors hover:bg-gray-50"
          >
            Export
          </button>
          <button
            type="button"
            onClick={() => onUpdate(quiz.id, { published: !quiz.published })}
            className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
              quiz.published
                ? "bg-warning/15 text-warning hover:bg-warning/25"
                : "bg-success text-white hover:bg-success/85"
            }`}
          >
            {quiz.published ? "Unpublish" : "Publish"}
          </button>
        </div>
        <button
          type="button"
          onClick={() => onDelete(quiz.id)}
          className="w-full rounded-lg border border-danger/40 bg-white px-3 py-2 text-sm font-medium text-danger transition-colors hover:bg-danger/5"
        >
          Delete
        </button>
      </div>
    </div>
  );
}

const WIZARD_STEPS = [
  { number: 1, label: "Select Materials" },
  { number: 2, label: "Select Objectives" },
  { number: 3, label: "Quiz Settings" },
];

function CreateQuizWizard({ courseId, onCreated }) {
  const showToast = useToast();
  const [step, setStep] = useState(1);
  const [selectedMaterials, setSelectedMaterials] = useState([]);
  const [selectedObjectives, setSelectedObjectives] = useState([]);
  const [quizName, setQuizName] = useState("");
  const [releaseDate, setReleaseDate] = useState("");
  const [expireDate, setExpireDate] = useState("");
  const [deliveryFormat, setDeliveryFormat] = useState("all-approved");

  const materialsQuery = useQuery({
    queryKey: ["materials", courseId],
    queryFn: () => api.get(`/api/material/course/${courseId}`),
    enabled: !!courseId,
  });
  const materials = materialsQuery.data?.materials || [];

  const objectivesQuery = useQuery({
    queryKey: ["objectives", courseId],
    queryFn: () => api.get(`/api/objective?courseId=${courseId}`),
    enabled: !!courseId,
  });
  const objectives = objectivesQuery.data?.objectives || [];
  const relevantObjectives = objectives.filter(
    (obj) =>
      Array.isArray(obj.materialIds) &&
      obj.materialIds.some((id) => selectedMaterials.includes(id))
  );

  const questionsQuery = useQuery({
    queryKey: ["questions", courseId],
    queryFn: () => api.get(`/api/question?courseId=${courseId}`),
    enabled: !!courseId && step === 3,
  });
  const courseQuestions = questionsQuery.data?.questions || [];

  const selectedObjStrs = selectedObjectives.map(toStringId);
  const matchedQuestions = courseQuestions.filter((q) =>
    selectedObjStrs.includes(toStringId(q.learningObjectiveId))
  );

  const createMutation = useMutation({
    mutationFn: (payload) => api.post("/api/quiz", payload),
    onSuccess: () => {
      showToast("Quiz created successfully", "success");
      setQuizName("");
      setReleaseDate("");
      setExpireDate("");
      setSelectedMaterials([]);
      setSelectedObjectives([]);
      setStep(1);
      onCreated();
    },
    onError: (error) => showToast(error.message || "Failed to create quiz", "error"),
  });

  const toggleSelection = (list, setList, value) => {
    setList(
      list.includes(value) ? list.filter((v) => v !== value) : [...list, value]
    );
  };

  const handleNextStep1 = () => {
    if (selectedMaterials.length === 0) {
      showToast("Please select at least one material", "error");
      return;
    }
    setStep(2);
  };

  const handleNextStep2 = () => {
    if (selectedObjectives.length === 0) {
      showToast("Please select at least one learning objective", "error");
      return;
    }
    setStep(3);
  };

  const handleCreate = () => {
    const name = quizName.trim();
    if (!name) {
      showToast("Please provide a quiz name", "error");
      return;
    }
    if (!releaseDate) {
      showToast("Please select a release date", "error");
      return;
    }
    if (!expireDate) {
      showToast("Please select an expire date", "error");
      return;
    }
    if (matchedQuestions.length === 0) {
      showToast("No questions matched the selected objectives", "error");
      return;
    }

    createMutation.mutate({
      name,
      courseId,
      deliveryFormat,
      releaseDate: new Date(releaseDate).toISOString(),
      expireDate: new Date(expireDate).toISOString(),
      questionIds: matchedQuestions.map(getObjectId),
    });
  };

  const selectionItemClass =
    "flex cursor-pointer items-center gap-3 rounded-xl border border-gray-200 p-3 transition-colors hover:border-primary/40 has-checked:border-primary has-checked:bg-primary/5";

  return (
    <div className="rounded-2xl bg-white p-8 shadow-sm">
      {/* Wizard steps */}
      <div className="mb-8 flex items-center justify-center gap-4">
        {WIZARD_STEPS.map(({ number, label }, index) => (
          <div key={number} className="flex items-center gap-4">
            {index > 0 && <div className="h-px w-16 bg-gray-200" />}
            <div className="flex items-center gap-2">
              <div
                className={`flex h-9 w-9 items-center justify-center rounded-full text-sm font-bold ${
                  number === step
                    ? "bg-primary text-white"
                    : number < step
                      ? "bg-success text-white"
                      : "bg-gray-200 text-muted"
                }`}
              >
                {number < step ? <i className="fas fa-check" /> : number}
              </div>
              <span
                className={`text-sm font-medium ${
                  number === step ? "text-ink" : "text-muted"
                }`}
              >
                {label}
              </span>
            </div>
          </div>
        ))}
      </div>

      {step === 1 && (
        <div>
          <h3 className="text-lg font-semibold text-ink">Select Course Materials</h3>
          <p className="mb-4 text-sm text-muted">
            Choose the materials you want to test the students on.
          </p>
          <div className="max-h-96 space-y-2 overflow-y-auto">
            {materialsQuery.isPending ? (
              <div className="py-6 text-center text-muted">
                <i className="fas fa-spinner fa-spin mr-2" /> Loading materials...
              </div>
            ) : materials.length === 0 ? (
              <div className="py-6 text-center text-muted">
                No course materials found. Upload materials first.
              </div>
            ) : (
              materials.map((material) => {
                const meta = materialTypeMeta(material.fileType || "");
                const value = material.sourceId || material._id;
                return (
                  <label key={value} className={selectionItemClass}>
                    <input
                      type="checkbox"
                      checked={selectedMaterials.includes(value)}
                      onChange={() =>
                        toggleSelection(selectedMaterials, setSelectedMaterials, value)
                      }
                      className="h-4 w-4 accent-primary"
                    />
                    <div
                      className={`flex h-9 w-9 items-center justify-center rounded-lg ${meta.classes}`}
                    >
                      <i className={`fas ${meta.icon}`} />
                    </div>
                    <div className="min-w-0">
                      <div className="truncate font-medium text-ink">
                        {material.documentTitle || "Untitled Material"}
                      </div>
                      <div className="text-xs text-muted">{meta.label}</div>
                    </div>
                  </label>
                );
              })
            )}
          </div>
          <div className="mt-6 flex justify-end">
            <button
              type="button"
              onClick={handleNextStep1}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 font-medium text-white transition-colors hover:bg-primary-dark"
            >
              Next: Select Objectives <i className="fas fa-arrow-right" />
            </button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div>
          <h3 className="text-lg font-semibold text-ink">Select Learning Objectives</h3>
          <p className="mb-4 text-sm text-muted">
            Select the meta learning objectives to include. Questions tied to these and
            their granular objectives will be added.
          </p>
          <div className="max-h-96 space-y-2 overflow-y-auto">
            {objectivesQuery.isPending ? (
              <div className="py-6 text-center text-muted">
                <i className="fas fa-spinner fa-spin mr-2" /> Loading objectives...
              </div>
            ) : relevantObjectives.length === 0 ? (
              <div className="py-6 text-center text-muted">
                No meta learning objectives found for selected materials.
              </div>
            ) : (
              relevantObjectives.map((objective) => (
                <label key={objective._id} className={selectionItemClass}>
                  <input
                    type="checkbox"
                    checked={selectedObjectives.includes(objective._id)}
                    onChange={() =>
                      toggleSelection(
                        selectedObjectives,
                        setSelectedObjectives,
                        objective._id
                      )
                    }
                    className="h-4 w-4 accent-primary"
                  />
                  <span className="font-medium text-ink">{objective.name}</span>
                </label>
              ))
            )}
          </div>
          <div className="mt-6 flex justify-between">
            <button
              type="button"
              onClick={() => setStep(1)}
              className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-5 py-2.5 font-medium text-ink transition-colors hover:bg-gray-50"
            >
              <i className="fas fa-arrow-left" /> Back
            </button>
            <button
              type="button"
              onClick={handleNextStep2}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 font-medium text-white transition-colors hover:bg-primary-dark"
            >
              Next: Quiz Settings <i className="fas fa-arrow-right" />
            </button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div>
          <h3 className="mb-4 text-lg font-semibold text-ink">Quiz Settings</h3>

          <div className="space-y-4">
            <div>
              <label htmlFor="new-quiz-name" className="mb-1 block text-sm font-semibold text-ink">
                Quiz Name
              </label>
              <input
                id="new-quiz-name"
                type="text"
                value={quizName}
                onChange={(event) => setQuizName(event.target.value)}
                placeholder="e.g. Midterm Review Quiz"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-primary focus:outline-none"
              />
            </div>

            <div className="flex gap-5">
              <div className="flex-1">
                <label htmlFor="quiz-release-date" className="mb-1 block text-sm font-semibold text-ink">
                  Release Date
                </label>
                <input
                  id="quiz-release-date"
                  type="datetime-local"
                  value={releaseDate}
                  onChange={(event) => setReleaseDate(event.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-primary focus:outline-none"
                />
              </div>
              <div className="flex-1">
                <label htmlFor="quiz-expire-date" className="mb-1 block text-sm font-semibold text-ink">
                  Expire Date
                </label>
                <input
                  id="quiz-expire-date"
                  type="datetime-local"
                  value={expireDate}
                  onChange={(event) => setExpireDate(event.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-primary focus:outline-none"
                />
              </div>
            </div>

            <div>
              <label className="mb-1 block text-sm font-semibold text-ink">
                Delivery Format
              </label>
              <DeliveryFormatToggle value={deliveryFormat} onChange={setDeliveryFormat} />
            </div>

            <div className="rounded-xl bg-page p-5">
              <div className="flex items-center gap-4">
                <i className="fas fa-list-ol text-2xl text-primary" />
                <div>
                  <div className="text-sm text-muted">Matching Questions Found</div>
                  <div className="text-2xl font-bold text-ink">
                    {questionsQuery.isPending ? (
                      <i className="fas fa-spinner fa-spin text-base" />
                    ) : (
                      matchedQuestions.length
                    )}
                  </div>
                </div>
              </div>
              <div className="my-4 space-y-1">
                {relevantObjectives
                  .filter((obj) => selectedObjStrs.includes(toStringId(obj._id)))
                  .map((obj) => {
                    const count = matchedQuestions.filter(
                      (q) => toStringId(q.learningObjectiveId) === toStringId(obj._id)
                    ).length;
                    return (
                      <div
                        key={obj._id}
                        className="flex justify-between border-b border-dashed border-gray-200 py-1.5 text-sm text-gray-600"
                      >
                        <span className="mr-4 truncate">{obj.name}</span>
                        <span className="whitespace-nowrap font-semibold text-ink">
                          {count} Qs
                        </span>
                      </div>
                    );
                  })}
              </div>
              <p className="text-xs text-muted">
                These questions will be associated with your new quiz.
              </p>
            </div>
          </div>

          <div className="mt-6 flex justify-between">
            <button
              type="button"
              onClick={() => setStep(2)}
              className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-5 py-2.5 font-medium text-ink transition-colors hover:bg-gray-50"
            >
              <i className="fas fa-arrow-left" /> Back
            </button>
            <button
              type="button"
              onClick={handleCreate}
              disabled={createMutation.isPending}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 font-medium text-white transition-colors hover:bg-primary-dark disabled:opacity-60"
            >
              {createMutation.isPending ? (
                <>
                  <i className="fas fa-spinner fa-spin" /> Creating...
                </>
              ) : (
                <>
                  <i className="fas fa-check" /> Create Quiz
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function Quizzes() {
  const navigate = useNavigate();
  const showToast = useToast();
  const queryClient = useQueryClient();
  const selectedCourse = useAppStore((state) => state.selectedCourse);
  const courseId = selectedCourse?.id;

  const [activeTab, setActiveTab] = useState("manage-quizzes");
  const [exportQuiz, setExportQuiz] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);

  // Quizzes plus their questions (needed for approval progress and export)
  const quizzesQuery = useQuery({
    queryKey: ["quizzes-with-questions", courseId],
    queryFn: async () => {
      const data = await api.get(`/api/quiz/course/${courseId}`);
      const quizzes = data.success ? data.quizzes || [] : [];
      return Promise.all(
        quizzes.map(async (quiz) => {
          const qData = await api
            .get(`/api/quiz/${quiz._id}/questions`)
            .catch(() => null);
          const questions = qData?.success ? qData.questions : [];
          return {
            ...quiz,
            id: getObjectId(quiz),
            questions: questions.map((q) => ({ ...q, id: getObjectId(q) })),
          };
        })
      );
    },
    enabled: !!courseId,
  });
  const quizzes = quizzesQuery.data || [];

  const refetchQuizzes = () =>
    queryClient.invalidateQueries({ queryKey: ["quizzes-with-questions", courseId] });

  const updateMutation = useMutation({
    mutationFn: ({ quizId, updates }) => api.put(`/api/quiz/${quizId}`, updates),
    onSuccess: (data, { successMessage }) => {
      if (successMessage) showToast(successMessage, "success");
      refetchQuizzes();
    },
    onError: (error) => showToast(error.message || "Failed to update quiz", "error"),
  });

  const deleteMutation = useMutation({
    mutationFn: (quizId) => api.delete(`/api/quiz/${quizId}`),
    onSuccess: () => {
      showToast("Quiz deleted successfully", "success");
      refetchQuizzes();
    },
    onError: (error) => showToast(error.message || "Failed to delete quiz", "error"),
  });

  const handleExport = async (format) => {
    if (!exportQuiz) return;
    try {
      const response = await fetch(`/api/question/export?format=${format}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          course: courseId,
          quizName: exportQuiz.name,
          questions: exportQuiz.questions,
        }),
      });
      if (!response.ok) throw new Error("Export failed");

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const extension = format === "csv" ? "csv" : format === "json" ? "json" : "zip";
      a.download = `quiz-${exportQuiz.name.replace(/\s+/g, "-").toLowerCase()}-${Date.now()}.${extension}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      setExportQuiz(null);
    } catch (error) {
      console.error("Error exporting quiz:", error);
      showToast("Failed to export quiz", "error");
    }
  };

  return (
    <div className="mx-auto max-w-6xl p-8">
      {/* Tabs */}
      <div className="mb-6 flex gap-2">
        {[
          { id: "manage-quizzes", label: "Manage Quizzes" },
          { id: "create-quiz", label: "Create New Quiz" },
        ].map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`rounded-lg px-5 py-2.5 text-sm font-semibold transition-colors ${
              activeTab === tab.id
                ? "bg-primary text-white"
                : "bg-white text-muted shadow-sm hover:text-ink"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "manage-quizzes" ? (
        quizzesQuery.isPending ? (
          <div className="py-16 text-center text-muted">
            <i className="fas fa-spinner fa-spin mb-3 text-2xl" />
            <p>Loading quizzes...</p>
          </div>
        ) : quizzes.length === 0 ? (
          <div className="rounded-2xl bg-white py-16 text-center shadow-sm">
            <i className="fas fa-clipboard-list mb-4 text-4xl text-gray-300" />
            <h3 className="text-lg font-semibold text-ink">No Quizzes Found</h3>
            <p className="mt-1 text-muted">
              There are no quizzes created for this course yet.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 xl:grid-cols-3">
            {quizzes.map((quiz) => (
              <QuizCard
                key={quiz.id}
                quiz={quiz}
                onUpdate={(quizId, updates, successMessage) =>
                  updateMutation.mutate({ quizId, updates, successMessage })
                }
                onReview={(quizId) =>
                  navigate(`/question-bank?quiz=${quizId}&status=Draft&tab=overview`)
                }
                onExport={setExportQuiz}
                onDelete={setDeleteTarget}
              />
            ))}
          </div>
        )
      ) : (
        <CreateQuizWizard
          courseId={courseId}
          onCreated={() => {
            refetchQuizzes();
            setActiveTab("manage-quizzes");
          }}
        />
      )}

      {/* Export modal */}
      <Modal
        open={!!exportQuiz}
        onClose={() => setExportQuiz(null)}
        title="Export Quiz"
        wide
      >
        <h3 className="mb-2 text-xl font-semibold text-ink">{exportQuiz?.name}</h3>
        <p className="mb-5 flex items-center gap-2 text-sm text-muted">
          <i className="fas fa-info-circle" />
          Select a format to download your quiz questions.
        </p>
        <p className="mb-3 text-sm font-semibold text-ink">Select Format</p>
        <div className="grid grid-cols-3 gap-3">
          {[
            { format: "qti", icon: "fa-file-archive", label: "Canvas (QTI)", note: "ZIP format for LMS" },
            { format: "csv", icon: "fa-file-csv", label: "CSV", note: "Excel / Sheets" },
            { format: "json", icon: "fa-file-code", label: "JSON", note: "Raw Data" },
          ].map((option) => (
            <button
              key={option.format}
              type="button"
              onClick={() => handleExport(option.format)}
              className="flex flex-col items-center gap-1 rounded-xl border border-gray-200 p-5 transition-all hover:-translate-y-0.5 hover:border-primary hover:shadow-md"
            >
              <i className={`fas ${option.icon} mb-1 text-2xl text-primary`} />
              <span className="font-semibold text-ink">{option.label}</span>
              <small className="text-muted">{option.note}</small>
            </button>
          ))}
        </div>
      </Modal>

      <ConfirmModal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteMutation.mutate(deleteTarget)}
        title="Delete Quiz"
        message="Are you sure you want to delete this quiz? This action cannot be undone."
        danger
      />
    </div>
  );
}
