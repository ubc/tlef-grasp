import { useSearchParams } from "react-router-dom";
import { useSelectedCourseId } from "../stores/appStore";
import { useCurrentUser } from "../hooks/useCurrentUser";
import QuestionsTab from "./question-bank/QuestionsTab";
import ObjectivesTab from "./question-bank/ObjectivesTab";

const VALID_TABS = ["overview", "objectives"];

const TABS = [
  { id: "overview", label: "Questions" },
  { id: "objectives", label: "Learning Objectives" },
];

export default function QuestionBank() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { isFaculty } = useCurrentUser();
  const courseId = useSelectedCourseId();

  const tabParam = searchParams.get("tab");
  const activeTab = VALID_TABS.includes(tabParam) ? tabParam : "overview";
  const materialFilter = searchParams.get("material") || "all";

  const switchTab = (tab) => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set("tab", tab);
        return next;
      },
      { replace: true }
    );
  };

  return (
    <div className="mx-auto max-w-7xl p-4 md:p-8">
      {/* Tabs */}
      <div className="mb-6 flex gap-2">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => switchTab(tab.id)}
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

      {activeTab === "overview" ? (
        <QuestionsTab courseId={courseId} isFaculty={isFaculty} />
      ) : (
        <ObjectivesTab
          courseId={courseId}
          isFaculty={isFaculty}
          materialFilter={materialFilter}
          onMaterialFilterChange={(value) =>
            setSearchParams(
              (prev) => {
                const next = new URLSearchParams(prev);
                if (value && value !== "all") next.set("material", value);
                else next.delete("material");
                return next;
              },
              { replace: true }
            )
          }
        />
      )}
    </div>
  );
}
