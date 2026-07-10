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
      questions: quiz.questions,
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
