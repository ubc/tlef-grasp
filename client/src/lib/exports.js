// Quiz export download (QTI zip / CSV / JSON).
//
// Uses raw fetch because the response is a binary blob, not JSON.

// The questions an export left out (#63), from the server's summary: their
// positions in the quiz's question list and the reasons. Returns null when
// nothing was left out, else { count, questions: [{ title, reason }] }; count
// can exceed the questions listed when the summary was cut short.
export function describeLeftOut(summary, questions = []) {
  if (!summary || !(summary.count > 0)) return null;
  const listed = (Array.isArray(summary.questions) ? summary.questions : []).map(({ index, reason }) => {
    const question = questions[index] || {};
    const text = String(question.title || question.stem || "").replace(/\s+/g, " ").trim();
    const title = text.length > 80 ? `${text.slice(0, 79)}…` : text || `Question ${index + 1}`;
    return { title, reason: String(reason || "") };
  });
  return { count: summary.count, questions: listed };
}

// The X-Export-Left-Out header: URI-encoded JSON, or absent.
export function parseLeftOutHeader(raw) {
  if (!raw) return null;
  try {
    return JSON.parse(decodeURIComponent(raw));
  } catch {
    return null;
  }
}

// Resolves to { leftOut } (see describeLeftOut). A failed export throws an
// Error with the server's message, and `leftOut` when nothing could be
// exported because every question was left out.
export async function downloadQuizExport({ courseId, quiz, format }) {
  const response = await fetch(`/api/question/export?format=${format}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      course: courseId,
      quizName: quiz.name,
      quizDescription: quiz.description || "",
      questions: quiz.questions,
      // Quiz settings so a JSON export can be re-imported as a working quiz
      // (Phase 4). Availability is per-section and intentionally excluded.
      quizMeta: {
        name: quiz.name,
        description: quiz.description || "",
        deliveryFormat: quiz.deliveryFormat,
        disablePreviousNavigation: quiz.disablePreviousNavigation,
        timeLimitMinutes: quiz.timeLimitMinutes,
        published: quiz.published,
        createdAt: quiz.createdAt,
      },
    }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const error = new Error(body?.error || "Export failed");
    error.leftOut = describeLeftOut(body?.leftOut, quiz.questions);
    throw error;
  }
  const leftOut = describeLeftOut(parseLeftOutHeader(response.headers.get("X-Export-Left-Out")), quiz.questions);

  const blob = await response.blob();
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  const extension =
    format === "csv" ? "csv" : format === "json" ? "json" : format === "h5p" ? "h5p" : "zip";
  link.download = `quiz-${quiz.name.replace(/\s+/g, "-").toLowerCase()}-${Date.now()}.${extension}`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
  return { leftOut };
}

// Export selected question-bank questions by ID (CSV or JSON only). The server
// re-reads the full, current question docs so the slim bank list shape is fine.
export async function downloadQuestionsExport({ courseId, questionIds, format }) {
  const response = await fetch(`/api/question/export?format=${format}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      course: courseId,
      questionIds,
    }),
  });
  if (!response.ok) throw new Error("Export failed");

  const blob = await response.blob();
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  const extension = format === "csv" ? "csv" : "json";
  link.download = `questions-${Date.now()}.${extension}`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}

// Analytics view ("questions" | "quizzes" | "objectives") as a CSV download,
// with the same quiz/section filters as the page. The server names the file.
export async function downloadAnalyticsCsv({ courseId, view, quizId, sectionId }) {
  const params = new URLSearchParams();
  if (quizId) params.set("quizId", quizId);
  if (sectionId) params.set("sectionId", sectionId);
  const search = params.toString();
  const response = await fetch(
    `/api/analytics/course/${courseId}/export/${view}${search ? `?${search}` : ""}`
  );
  if (!response.ok) throw new Error("Export failed");

  const disposition = response.headers.get("content-disposition") || "";
  const filename = /filename="([^"]+)"/.exec(disposition)?.[1] || `analytics-${view}.csv`;

  const blob = await response.blob();
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}
