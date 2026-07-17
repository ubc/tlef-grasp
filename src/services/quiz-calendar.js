const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_RANGE_MS = 370 * DAY_MS;

const asValidDate = (value) => {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const parseCalendarRange = (from, to, now = new Date()) => {
  const defaultFrom = new Date(now.getFullYear(), now.getMonth(), 1);
  const defaultTo = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const start = from ? asValidDate(from) : defaultFrom;
  const end = to ? asValidDate(to) : defaultTo;

  if (!start || !end || end <= start) {
    return { error: "from and to must define a valid ascending date range" };
  }
  if (end - start > MAX_RANGE_MS) {
    return { error: "Calendar ranges cannot exceed 370 days" };
  }
  return { from: start, to: end };
};

const windowStatus = (releaseDate, expireDate, now = new Date()) => {
  const release = asValidDate(releaseDate);
  const expire = asValidDate(expireDate);
  if (!release || !expire) return "invalid";
  if (now < release) return "upcoming";
  if (now > expire) return "expired";
  return "open";
};

const isWithinRange = (date, from, to) => date >= from && date < to;

const isSameUtcDay = (a, b) =>
  a.getUTCFullYear() === b.getUTCFullYear()
  && a.getUTCMonth() === b.getUTCMonth()
  && a.getUTCDate() === b.getUTCDate();

/**
 * Convert quiz availability windows into the small, answer-free event contract
 * used by both dashboards.
 */
const buildCalendarEvents = ({
  quizzes = [],
  schedulesByQuiz = new Map(),
  sectionsById = new Map(),
  completedQuizIds = [],
  audience,
  from,
  to,
  now = new Date(),
}) => {
  const completed = new Set(completedQuizIds.map(String));
  const events = [];
  const seenAvailableQuizIds = new Set();

  for (const quiz of quizzes) {
    const quizId = String(quiz._id || quiz.id);
    const rows = schedulesByQuiz.get(quizId) || [];
    const seenStudentWindows = new Set();

    for (const row of rows) {
      const release = asValidDate(row.releaseDate);
      const deadline = asValidDate(row.expireDate);
      if (!release || !deadline) continue;

      // A student in two sections with the same window should see one quiz,
      // while instructors need each section kept distinct for management.
      const windowKey = `${release.toISOString()}:${deadline.toISOString()}`;
      if (audience === "student" && seenStudentWindows.has(windowKey)) continue;
      seenStudentWindows.add(windowKey);

      const sectionId = String(row.courseSectionId);
      const section = sectionsById.get(sectionId);
      const status = completed.has(quizId)
        ? "completed"
        : windowStatus(release, deadline, now);
      const shared = {
        quizId,
        quizName: quiz.name || "Unnamed Quiz",
        published: quiz.published === true,
        sectionId: audience === "instructor" ? sectionId : undefined,
        sectionLabel:
          audience === "instructor"
            ? section?.sectionNumber || section?.sectionId || "Unknown section"
            : undefined,
        releaseDate: release.toISOString(),
        expireDate: deadline.toISOString(),
        status,
      };

      if (isWithinRange(release, from, to)) {
        events.push({
          ...shared,
          id: `${quizId}:${sectionId}:release`,
          type: "release",
          eventAt: release.toISOString(),
        });
      }
      if (
        audience === "student" &&
        windowStatus(release, deadline, now) === "open" &&
        isWithinRange(now, from, to) &&
        !isSameUtcDay(release, now) &&
        !isSameUtcDay(deadline, now) &&
        !seenAvailableQuizIds.has(quizId)
      ) {
        seenAvailableQuizIds.add(quizId);
        events.push({
          ...shared,
          id: `${quizId}:available`,
          type: "availability",
          eventAt: now.toISOString(),
        });
      }
      if (isWithinRange(deadline, from, to)) {
        events.push({
          ...shared,
          id: `${quizId}:${sectionId}:deadline`,
          type: "deadline",
          eventAt: deadline.toISOString(),
        });
      }
    }
  }

  return events.sort((a, b) => new Date(a.eventAt) - new Date(b.eventAt));
};

module.exports = {
  buildCalendarEvents,
  parseCalendarRange,
  windowStatus,
};
