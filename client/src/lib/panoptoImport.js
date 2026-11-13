// Pure helpers for connecting Panopto and importing a video's captions into
// Course Materials. No React or DOM here so tests/client can cover them.

import { pluralize } from "./lmsRosterSync.js";

/**
 * Panopto's sign-in, coming back to `returnTo` (a path on GRASP) afterwards.
 * The server ignores a returnTo that is not a GRASP path.
 */
export function panoptoConnectUrl(returnTo) {
  return returnTo
    ? `/api/panopto/auth/login?returnTo=${encodeURIComponent(returnTo)}`
    : "/api/panopto/auth/login";
}

// Why a connection attempt came back unfinished: the `panopto` query
// parameter the server's sign-in callback redirects to (routes/panopto.js).
export const PANOPTO_RETURN_ERRORS = new Map([
  [
    "error",
    "Panopto could not complete the connection. Please try again.",
  ],
  [
    "account-mismatch",
    "That Panopto account is not yours, so GRASP did not connect it. Sign out of Panopto, sign back in with your own account, then connect again.",
  ],
  [
    "identity-unavailable",
    "GRASP could not confirm that this Panopto account is yours, so it did not connect it. Please try again; if this keeps happening, contact the GRASP team.",
  ],
]);

// "1:05:09" or "52:03".
export function formatDuration(seconds) {
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0) return "";
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = String(total % 60).padStart(2, "0");
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${secs}`
    : `${minutes}:${secs}`;
}

// A video can be picked unless it is already a material here or Panopto
// offers no captions for it at all.
export function panoptoSessionSelectable(session) {
  return Boolean(session?.captions) && !session?.imported;
}

/** The line under a video's name that says why it cannot be picked. */
export function panoptoSessionNote(session) {
  if (session?.imported) {
    const title = session.imported.documentTitle;
    return title && title !== session.name
      ? `Already imported as "${title}"`
      : "Already imported";
  }
  if (!session?.captions) return "No captions in Panopto";
  return "";
}

// "BIOL 101 (in Biology)", so two folders with the same name can be told apart.
export function panoptoFolderLabel(folder) {
  const name = String(folder?.name || "").trim() || "Untitled folder";
  const parent = String(folder?.parentName || "").trim();
  return parent ? `${name} (in ${parent})` : name;
}

// Toast text + tone once an import run finishes.
export function describePanoptoImportResult({ imported = [], errors = [] } = {}) {
  const videos = (count) => pluralize(count, "video");
  if (errors.length === 0) {
    return { message: `Captions of ${videos(imported.length)} imported from Panopto`, type: "success" };
  }
  const failed = `${videos(errors.length)} could not be imported`;
  return {
    message:
      imported.length > 0
        ? `Captions of ${videos(imported.length)} imported from Panopto. ${failed}.`
        : `${failed}.`,
    type: imported.length > 0 ? "warning" : "error",
  };
}
