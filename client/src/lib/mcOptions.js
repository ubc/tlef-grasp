// Multiple-choice options are an object keyed by letter ({ A: { text,
// feedback, image }, ... }), two to eight of them lettered consecutively from
// A (issue #144). An option may carry one image (issue #146). Forms edit them
// as an ordered list of rows ({ id, text, feedback, image }) and convert back
// on save. Everything that reads or edits options goes through here so no
// screen assumes exactly four.

import {
  MC_OPTION_KEYS,
  MC_MIN_OPTIONS,
  MC_MAX_OPTIONS,
  MC_DEFAULT_OPTION_COUNT,
} from "./constants";

export { MC_OPTION_KEYS, MC_MIN_OPTIONS, MC_MAX_OPTIONS, MC_DEFAULT_OPTION_COUNT };

/** The option counts an instructor can ask AI generation for. */
export const MC_OPTION_COUNT_CHOICES = MC_OPTION_KEYS.map((_, i) => i + 1).filter(
  (n) => n >= MC_MIN_OPTIONS
);

/** The letters present on a question, in order. Accepts the legacy array form. */
export function optionKeysOf(options) {
  if (Array.isArray(options)) {
    return options.slice(0, MC_MAX_OPTIONS).map((_, i) => MC_OPTION_KEYS[i]);
  }
  if (!options || typeof options !== "object") return [];
  return MC_OPTION_KEYS.filter((key) => options[key] !== undefined && options[key] !== null);
}

/** One option by letter, for either stored form. */
export function optionAt(options, key) {
  if (Array.isArray(options)) return options[MC_OPTION_KEYS.indexOf(key)];
  if (!options || typeof options !== "object") return undefined;
  return options[key];
}

/** The displayed text of one option value ({ text } or a bare string). */
export function optionTextOf(raw) {
  if (raw && typeof raw === "object") return String(raw.text ?? "");
  return raw === undefined || raw === null ? "" : String(raw);
}

/** One option value's attached image ({ fileId, caption, ... }), or null. */
export function optionImageOf(raw) {
  return raw && typeof raw === "object" && raw.image?.fileId ? raw.image : null;
}

/** The index the server expects back for a letter (its position in A to H). */
export function optionIndexOf(key) {
  return MC_OPTION_KEYS.indexOf(key);
}

/** `count` blank rows lettered from A. */
export function emptyOptionRows(count = MC_DEFAULT_OPTION_COUNT) {
  return MC_OPTION_KEYS.slice(0, count).map((id) => ({ id, text: "", feedback: "", image: null }));
}

/**
 * Form rows for a question's options. A question with none (a new one, or a
 * type switch) gets the default four blank rows.
 */
export function optionRowsOf(options) {
  const keys = optionKeysOf(options);
  if (keys.length === 0) return emptyOptionRows();
  return keys.map((id) => {
    const raw = optionAt(options, id);
    return {
      id,
      text: optionTextOf(raw),
      feedback: raw && typeof raw === "object" ? String(raw.feedback || "") : "",
      image: optionImageOf(raw),
    };
  });
}

/** Re-letter rows A, B, C... in their current order. */
export function relabelOptionRows(rows) {
  return rows.map((row, i) => ({ ...row, id: MC_OPTION_KEYS[i] }));
}

/** Append a blank row, up to the maximum. */
export function addOptionRow(rows) {
  if (rows.length >= MC_MAX_OPTIONS) return rows;
  return relabelOptionRows([...rows, { id: "", text: "", feedback: "", image: null }]);
}

/**
 * Remove the row at `index` and re-letter the rest. The correct answer follows
 * its row to the new letter; removing the correct row leaves no answer marked
 * ("" ), so the form's validation asks for one.
 */
export function removeOptionRow(rows, index, correctAnswer) {
  if (rows.length <= MC_MIN_OPTIONS || index < 0 || index >= rows.length) {
    return { rows, correctAnswer };
  }
  const removedId = rows[index].id;
  const remaining = relabelOptionRows(rows.filter((_, i) => i !== index));
  if (correctAnswer === removedId) return { rows: remaining, correctAnswer: "" };
  const correctIndex = rows.findIndex((row) => row.id === correctAnswer);
  if (correctIndex === -1) return { rows: remaining, correctAnswer };
  const shifted = correctIndex > index ? correctIndex - 1 : correctIndex;
  return { rows: remaining, correctAnswer: remaining[shifted].id };
}

/** Rows back into the stored object shape (text and feedback trimmed). */
export function optionRowsToObject(rows) {
  return Object.fromEntries(
    relabelOptionRows(rows).map((row) => {
      const option = {
        text: String(row.text || "").trim(),
        feedback: String(row.feedback || "").trim(),
      };
      if (row.image?.fileId) option.image = row.image;
      return [row.id, option];
    })
  );
}

/**
 * Why a set of option rows cannot be saved, or "" when it can. Each option
 * needs text or an image, and no two may be the same: same text and same
 * image (or none). Two image-only options with different images are distinct.
 */
export function optionRowsError(rows) {
  if (rows.some((row) => !String(row.text || "").trim() && !row.image?.fileId)) {
    return "Each option needs text or an image";
  }
  const signatures = rows.map(
    (row) => `${String(row.text || "").trim().toLowerCase()}@${row.image?.fileId || ""}`
  );
  if (new Set(signatures).size !== signatures.length) {
    return "Options must be unique — no two options may be identical";
  }
  return "";
}

/** A requested generation option count, or the default when out of range. */
export function normalizeMcOptionCount(value, fallback = MC_DEFAULT_OPTION_COUNT) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n) || n < MC_MIN_OPTIONS || n > MC_MAX_OPTIONS) return fallback;
  return n;
}
