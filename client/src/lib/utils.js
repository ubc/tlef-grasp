import { QUESTION_TYPES } from "./constants";

export const toStringId = (id) => {
  if (!id) return "";
  if (typeof id === "string") return id;
  return String(id);
};

export const getObjectId = (obj) => (obj ? toStringId(obj._id || obj.id) : "");

export const QUESTION_TYPE_LABELS = {
  "fill-in-the-blank": "Fill-in-the-blank",
  calculation: "Calculation",
  "open-ended": "Open-ended",
  "multiple-choice": "Multiple choice",
};

export function normalizeQuestionTypeKey(raw) {
  const t = (raw || "").toString().trim().toLowerCase().replace(/_/g, "-");
  return QUESTION_TYPE_LABELS[t] ? t : QUESTION_TYPES.MULTIPLE_CHOICE;
}

export function formatQuestionTypeLabel(raw) {
  return QUESTION_TYPE_LABELS[normalizeQuestionTypeKey(raw)];
}

export const QUESTION_TYPE_CHIP_CLASSES = {
  "multiple-choice": "bg-blue-100 text-blue-700",
  "fill-in-the-blank": "bg-purple-100 text-purple-700",
  calculation: "bg-orange-100 text-orange-700",
  "open-ended": "bg-teal-100 text-teal-700",
};

// Resolve a user's role from an explicit role field or their affiliations.
export function getUserRole(user) {
  if (user.role) return user.role;
  const affiliation = user.affiliation || "";
  const affiliations = Array.isArray(affiliation)
    ? affiliation
    : String(affiliation).split(",").map((a) => a.trim());
  if (affiliations.includes("faculty")) return "faculty";
  if (affiliations.includes("staff")) return "staff";
  if (affiliations.includes("student") || affiliations.includes("affiliate"))
    return "student";
  return "unknown";
}

export function getMaterialIcon(type) {
  const info = { icon: "fas fa-file", color: "#718096" };
  if (!type) return info;
  const t = type.toLowerCase();
  if (t.includes("pdf")) {
    info.icon = "fas fa-file-pdf";
    info.color = "#e74c3c";
  } else if (t.includes("text") || t.includes("plain")) {
    info.icon = "fas fa-file-alt";
    info.color = "#f39c12";
  } else if (t.includes("word") || t.includes("officedocument")) {
    info.icon = "fas fa-file-word";
    info.color = "#3498db";
  } else if (t.includes("link")) {
    info.icon = "fas fa-link";
    info.color = "#9b59b6";
  } else if (t.includes("video")) {
    info.icon = "fas fa-file-video";
    info.color = "#27ae60";
  }
  return info;
}
