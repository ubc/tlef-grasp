import { useRef, useState } from "react";
import { useSelectedCourseId } from "../stores/appStore";
import { useCourseQuizzes } from "../hooks/useQuizzes";
import { useVisibleCourseSections } from "../hooks/useSections";
import { useToast } from "../components/ui/Toast";
import { downloadAnalyticsCsv } from "../lib/exports";
import QuizzesTab from "./analytics/QuizzesTab";
import QuestionsTab from "./analytics/QuestionsTab";
import ObjectivesTab from "./analytics/ObjectivesTab";

// Class-level analytics. Everything on this page is an aggregate over the
// students in scope; per-student results live on Quiz Scores.
const TABS = [
  { id: "quizzes", label: "Quizzes", icon: "fa-clipboard-list", Panel: QuizzesTab },
  { id: "questions", label: "Questions", icon: "fa-circle-question", Panel: QuestionsTab },
  { id: "objectives", label: "Objectives", icon: "fa-bullseye", Panel: ObjectivesTab },
];

const tabId = (id) => `analytics-tab-${id}`;
const panelId = (id) => `analytics-panel-${id}`;

const selectClass =
  "rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-primary focus:outline-none";

export default function Analytics() {
  const courseId = useSelectedCourseId();
  const showToast = useToast();
  const [activeTab, setActiveTab] = useState(TABS[0].id);
  const [quizId, setQuizId] = useState("");
  const [sectionId, setSectionId] = useState("");
  const [exporting, setExporting] = useState(false);
  const tabRefs = useRef({});

  const { quizzes } = useCourseQuizzes(courseId);
  const { sections } = useVisibleCourseSections(courseId);
  const active = TABS.find((tab) => tab.id === activeTab);
  const ActivePanel = active.Panel;

  // WAI-ARIA tabs: arrow keys move between tabs (wrapping), Home/End jump to
  // the ends, and only the selected tab is in the Tab order.
  const handleTabKeyDown = (event) => {
    const index = TABS.findIndex((tab) => tab.id === activeTab);
    const next = {
      ArrowRight: (index + 1) % TABS.length,
      ArrowLeft: (index - 1 + TABS.length) % TABS.length,
      Home: 0,
      End: TABS.length - 1,
    }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    setActiveTab(TABS[next].id);
    tabRefs.current[TABS[next].id]?.focus();
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      await downloadAnalyticsCsv({ courseId, view: activeTab, quizId, sectionId });
    } catch {
      showToast("Could not export analytics. Please try again.", "error");
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="mx-auto max-w-6xl p-4 md:p-8">
      <h1 className="mb-1 text-2xl font-bold text-ink">Analytics</h1>

      <div className="mb-5 flex flex-wrap items-center gap-4">
        <select
          aria-label="Filter analytics by quiz"
          value={quizId}
          onChange={(event) => setQuizId(event.target.value)}
          className={`min-w-64 ${selectClass}`}
        >
          <option value="">All quizzes</option>
          {quizzes.map((quiz) => (
            <option key={quiz._id} value={quiz._id}>
              {quiz.name}
            </option>
          ))}
        </select>
        {sections.length > 0 && (
          <select
            aria-label="Filter analytics by section"
            value={sectionId}
            onChange={(event) => setSectionId(event.target.value)}
            className={selectClass}
          >
            <option value="">All sections</option>
            {sections.map((section) => (
              <option key={section.sectionId} value={section.sectionId}>
                {section.sectionNumber || section.sectionId}
              </option>
            ))}
          </select>
        )}
        <button
          type="button"
          onClick={handleExport}
          disabled={!courseId || exporting}
          aria-busy={exporting}
          className="ml-auto inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-ink transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <i
            className={`fas ${exporting ? "fa-spinner fa-spin" : "fa-file-csv"}`}
            aria-hidden="true"
          />
          {exporting ? "Exporting..." : `Export ${active.label} CSV`}
        </button>
      </div>

      <div
        role="tablist"
        aria-label="Analytics views"
        className="mb-5 flex gap-2 overflow-x-auto border-b border-gray-200"
      >
        {TABS.map((tab) => {
          const selected = tab.id === activeTab;
          return (
            <button
              key={tab.id}
              ref={(node) => {
                tabRefs.current[tab.id] = node;
              }}
              id={tabId(tab.id)}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={panelId(tab.id)}
              tabIndex={selected ? 0 : -1}
              onClick={() => setActiveTab(tab.id)}
              onKeyDown={handleTabKeyDown}
              className={`-mb-px whitespace-nowrap border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
                selected
                  ? "border-primary text-primary"
                  : "border-transparent text-muted hover:text-ink"
              }`}
            >
              <i className={`fas ${tab.icon} mr-2`} aria-hidden="true" />
              {tab.label}
            </button>
          );
        })}
      </div>

      <div
        role="tabpanel"
        id={panelId(activeTab)}
        aria-labelledby={tabId(activeTab)}
        tabIndex={0}
        className="rounded-2xl focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <ActivePanel courseId={courseId} quizId={quizId} sectionId={sectionId} />
      </div>
    </div>
  );
}
