import { useMemo, useState } from "react";
import { useMyAchievements } from "../hooks/useAchievements";
import { useSelectedCourseId } from "../stores/appStore";
import { formatDate } from "../lib/format";

const ACHIEVEMENT_DISPLAY = {
  quiz_completed: {
    icon: "fas fa-check-circle",
    iconType: "completion",
    category: "Quiz Completion",
  },
  quiz_perfect: {
    icon: "fas fa-star",
    iconType: "perfect",
    category: "Perfect Score",
  },
};

const ICON_TYPE_CLASSES = {
  completion: "bg-green-100 text-green-800",
  perfect: "bg-yellow-100 text-yellow-800",
  default: "bg-primary/10 text-primary",
};

const FILTER_TABS = [
  { id: "all", label: "All" },
  { id: "quiz_completed", label: "Completed", icon: "fa-check-circle" },
  { id: "quiz_perfect", label: "Perfect Scores", icon: "fa-star" },
];

function StatCard({ icon, iconClasses, value, label }) {
  return (
    <div className="flex items-center gap-4 rounded-2xl bg-white p-5 shadow-sm">
      <div
        className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${iconClasses}`}
      >
        <i className={`fas ${icon} text-xl`} />
      </div>
      <div>
        <div className="text-2xl font-bold text-ink">{value}</div>
        <div className="text-sm text-muted">{label}</div>
      </div>
    </div>
  );
}

export default function Achievements() {
  const courseId = useSelectedCourseId();
  const [filter, setFilter] = useState("all");

  const achievementsQuery = useMyAchievements(courseId);

  const achievements = useMemo(
    () =>
      achievementsQuery.achievements.map((achievement) => {
        const displayInfo =
          ACHIEVEMENT_DISPLAY[achievement.type] || {
            icon: "fas fa-trophy",
            iconType: "default",
            category: "Achievement",
          };
        return {
          id: achievement._id?.toString() || achievement.id,
          title: achievement.title || "Achievement",
          description: achievement.description || "",
          icon: achievement.icon || displayInfo.icon,
          iconType: displayInfo.iconType,
          type: achievement.type,
          category: displayInfo.category,
          earnedDate: formatDate(achievement.earnedAt),
          quizName: achievement.quizName || "",
          score: achievement.score,
        };
      }),
    [achievementsQuery.achievements]
  );

  const filtered =
    filter === "all"
      ? achievements
      : achievements.filter((achievement) => achievement.type === filter);

  const completedCount = achievements.filter(
    (a) => a.type === "quiz_completed"
  ).length;
  const perfectCount = achievements.filter((a) => a.type === "quiz_perfect").length;

  return (
    <div className="mx-auto max-w-6xl p-4 md:p-8">
      <h1 className="mb-6 text-2xl font-bold text-ink">My Achievements</h1>

      {/* Stats */}
      <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          icon="fa-trophy"
          iconClasses="bg-primary/10 text-primary"
          value={achievements.length}
          label="Total Achievements"
        />
        <StatCard
          icon="fa-check-circle"
          iconClasses="bg-green-100 text-green-600"
          value={completedCount}
          label="Quizzes Completed"
        />
        <StatCard
          icon="fa-star"
          iconClasses="bg-yellow-100 text-yellow-600"
          value={perfectCount}
          label="Perfect Scores"
        />
      </div>

      {/* Filter tabs */}
      <div className="mb-6 flex gap-2">
        {FILTER_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setFilter(tab.id)}
            className={`inline-flex items-center gap-2 rounded-full px-5 py-2 text-sm font-medium transition-colors ${
              filter === tab.id
                ? "bg-primary text-white"
                : "bg-white text-muted shadow-sm hover:text-ink"
            }`}
          >
            {tab.icon && <i className={`fas ${tab.icon}`} />}
            {tab.label}
          </button>
        ))}
      </div>

      {/* Grid / empty state */}
      {achievementsQuery.isPending ? (
        <div className="py-10 text-center text-muted">
          <i className="fas fa-spinner fa-spin mb-4 text-3xl text-primary" />
          <p>Loading achievements...</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl bg-white py-16 text-center shadow-sm">
          <i className="fas fa-trophy mb-4 text-4xl text-gray-300" />
          <h3 className="text-lg font-semibold text-ink">No achievements yet</h3>
          <p className="mt-1 text-muted">
            Complete quizzes to earn achievements! Get a perfect score for bonus
            achievements.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((achievement) => (
            <div key={achievement.id} className="rounded-2xl bg-white p-6 shadow-sm">
              <div className="flex items-start gap-4">
                <div
                  className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${
                    ICON_TYPE_CLASSES[achievement.iconType] || ICON_TYPE_CLASSES.default
                  }`}
                >
                  <i className={`${achievement.icon} text-xl`} />
                </div>
                <div className="min-w-0">
                  <h3 className="font-semibold text-ink">{achievement.title}</h3>
                  <div className="text-xs font-medium text-success">
                    Earned on {achievement.earnedDate}
                  </div>
                </div>
              </div>

              <p className="mt-3 text-sm text-gray-600">{achievement.description}</p>

              {achievement.quizName && (
                <div className="mt-2 text-sm text-muted">
                  Quiz: {achievement.quizName}
                </div>
              )}
              {achievement.score !== undefined && (
                <div className="text-sm text-muted">Score: {achievement.score}%</div>
              )}

              <div className="mt-4">
                <span
                  className={`rounded-full px-3 py-1 text-xs font-semibold ${
                    ICON_TYPE_CLASSES[achievement.iconType] || ICON_TYPE_CLASSES.default
                  }`}
                >
                  {achievement.category}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
