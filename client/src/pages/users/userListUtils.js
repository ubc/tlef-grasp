export const UNKNOWN_USER_NAME = "Unknown User";

const nameCollator = new Intl.Collator(undefined, {
  sensitivity: "base",
  numeric: true,
});
const staffRoles = new Set(["faculty", "ta", "staff"]);

function cleanName(value) {
  return typeof value === "string" ? value.trim() : "";
}

// `name` leads a roster row: the legal name, else the display name. A student
// the Canvas roster sync created has no legal name until their first CWL
// sign-in, only the name Canvas gave them (issue #165). `legalName` is "" when
// none is on file.
export function getUserNames(user) {
  const legalName = cleanName(user?.legalName) || cleanName(user?.user?.legalName);
  const displayName = cleanName(user?.displayName) || cleanName(user?.user?.displayName);
  const name = legalName || displayName || UNKNOWN_USER_NAME;

  return {
    name,
    legalName,
    displayName,
    distinctDisplayName:
      displayName && nameCollator.compare(displayName, name) !== 0 ? displayName : "",
  };
}

export function filterAndSortCourseUsers(
  users,
  { sectionFilter = "all", search = "", getRole }
) {
  const normalizedSearch = search.trim().toLocaleLowerCase();
  const roleRank = (user) => (staffRoles.has(getRole(user)) ? 0 : 1);

  return users
    .filter(
      (user) =>
        sectionFilter === "all" ||
        (Array.isArray(user.sections) && user.sections.includes(sectionFilter))
    )
    .filter((user) => {
      if (!normalizedSearch) return true;
      const { name, displayName } = getUserNames(user);
      return `${name} ${displayName}`.toLocaleLowerCase().includes(normalizedSearch);
    })
    .sort((a, b) => {
      const rankDifference = roleRank(a) - roleRank(b);
      if (rankDifference !== 0) return rankDifference;

      const aNames = getUserNames(a);
      const bNames = getUserNames(b);
      const nameDifference = nameCollator.compare(aNames.name, bNames.name);
      if (nameDifference !== 0) return nameDifference;

      return nameCollator.compare(aNames.displayName, bNames.displayName);
    });
}

// --- Manual access (issue #115) -------------------------------------------

export const ROLE_LABELS = {
  faculty: "Faculty",
  ta: "TA",
  staff: "Staff",
  student: "Student",
};

function toDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatDate(value) {
  const date = toDate(value);
  return date
    ? date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
    : "";
}

export function formatDateTime(value) {
  const date = toDate(value);
  return date
    ? date.toLocaleString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "";
}

// Instructor-facing name for a person record: legal name first, like the
// roster (see getRosterName), then whatever else identifies them.
export function personLabel(person, fallback = UNKNOWN_USER_NAME) {
  return (
    cleanName(person?.legalName) ||
    cleanName(person?.displayName) ||
    cleanName(person?.email) ||
    fallback
  );
}

// One line for the roster explaining a manual membership: who let this
// person in, and when. Empty for roster-synced, invite-code, and owner
// memberships, which need no explanation.
export function describeMembershipSource(user) {
  if (user?.source !== "manual") return "";
  const by = personLabel(user.addedBy, "an instructor");
  const when = formatDate(user.joinedAt);
  return when ? `Added by ${by} on ${when}` : `Added by ${by}`;
}

const LMS_PROVIDER_LABELS = { canvas: "Canvas", moodle: "Moodle" };

function lmsRosterLabel(details) {
  const provider = LMS_PROVIDER_LABELS[details?.provider];
  return provider ? `the ${provider} roster` : "the LMS roster";
}

// Sentence for one access-log event, e.g. "Ada Lovelace added Bob Student
// to the course as TA".
export function describeAccessEvent(event) {
  const actor = personLabel(event?.actor, "An instructor");
  const target = personLabel(event?.target, "a user");
  const role = ROLE_LABELS[event?.role] || "";

  switch (event?.action) {
    case "added":
      return `${actor} added ${target} to the course${role ? ` as ${role}` : ""}`;
    case "promoted":
      return `${actor} made ${target} a TA`;
    case "demoted":
      return `${actor} removed the TA role from ${target}${role ? ` (now ${role})` : ""}`;
    case "removed":
      return `${actor} removed ${target} from the course${role ? ` (was ${role})` : ""}`;
    case "permissions-updated":
      return `${actor} updated the TA permissions of ${target}`;
    // LMS roster sync (issue #113): the actor is the instructor who ran it.
    case "sync-added": {
      const roster = lmsRosterLabel(event.details);
      if (!event.details?.restored) {
        return `${actor} added ${target} to a section from ${roster}`;
      }
      return `${actor} restored ${target} to a section from ${roster}${
        event.details.previouslyRemoved ? " (they had been removed from the course)" : ""
      }`;
    }
    case "sync-dropped":
      return `${actor} dropped ${target} from a section (no longer on ${lmsRosterLabel(
        event.details
      )})${event.details?.membershipRemoved ? " and removed them from the course" : ""}`;
    default:
      return `${actor} changed the access of ${target}`;
  }
}
