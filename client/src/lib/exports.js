// Quiz export download (QTI zip / CSV / JSON).
//
// Uses raw fetch because the response is a binary blob, not JSON.
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
  if (!response.ok) throw new Error("Export failed");

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
