import DeliveryFormatToggle from "../../components/DeliveryFormatToggle";

const TABS = [
  { id: "create", label: "Create New Quiz" },
  { id: "select", label: "Select Existing Quiz" },
];

// Step 3: pick an existing quiz or define a new one for the generated questions.
export default function SaveQuizStep({
  quizzes,
  quizzesPending,
  quizzesLoaded,
  tab,
  onTabChange,
  form,
  onFormChange,
}) {
  const set = (field) => (value) => onFormChange({ ...form, [field]: value });

  return (
    <div className="rounded-2xl bg-white p-8 shadow-sm">
      <p className="mb-6 text-muted">
        Select an existing quiz or create a new one to save your generated questions.
      </p>

      <div className="mb-6 flex gap-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => onTabChange(t.id)}
            className={`rounded-lg px-5 py-2.5 text-sm font-semibold transition-colors ${
              tab === t.id ? "bg-primary text-white" : "bg-page text-muted hover:text-ink"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "select" ? (
        <div>
          <label htmlFor="quiz-select-dropdown" className="mb-2 block font-medium text-ink">
            Choose a quiz:
          </label>
          <select
            id="quiz-select-dropdown"
            value={form.selectedQuizId}
            onChange={(event) => set("selectedQuizId")(event.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-3 focus:border-primary focus:outline-none"
          >
            {quizzesPending ? (
              <option value="">Loading quizzes...</option>
            ) : quizzes.length === 0 ? (
              <option value="">No quizzes available</option>
            ) : (
              <>
                <option value="">Select a quiz...</option>
                {quizzes.map((quiz) => (
                  <option key={quiz._id} value={quiz._id}>
                    {quiz.name}
                  </option>
                ))}
              </>
            )}
          </select>
          {quizzesLoaded && quizzes.length === 0 && (
            <p className="mt-4 text-sm text-muted">
              No quizzes found. Create a new quiz instead.
            </p>
          )}
        </div>
      ) : (
        <div>
          <label htmlFor="quiz-name-input" className="mb-2 block font-medium text-ink">
            Quiz Name <span className="text-danger">*</span>
          </label>
          <input
            id="quiz-name-input"
            type="text"
            value={form.quizName}
            onChange={(event) => set("quizName")(event.target.value)}
            placeholder="Enter quiz name..."
            className="mb-4 w-full rounded-lg border border-gray-300 px-3 py-3 focus:border-primary focus:outline-none"
          />
          <textarea
            value={form.quizDescription}
            onChange={(event) => set("quizDescription")(event.target.value)}
            placeholder="Enter quiz description..."
            rows={3}
            className="mb-5 w-full rounded-lg border border-gray-300 px-3 py-3 focus:border-primary focus:outline-none"
          />

          <div className="mb-4 rounded-lg bg-page px-4 py-3 text-sm text-muted">
            <i className="fas fa-circle-info mr-1.5 text-primary" />
            Availability is set per section after creation, from the Manage Quizzes
            tab (“Schedule per section”).
          </div>

          <div>
            <label className="mb-2 block font-medium text-ink">Delivery Format</label>
            <DeliveryFormatToggle
              value={form.deliveryFormat}
              onChange={set("deliveryFormat")}
            />
          </div>
        </div>
      )}
    </div>
  );
}
