export const UNKNOWN_USER_NAME = "Unknown User";

const nameCollator = new Intl.Collator(undefined, {
  sensitivity: "base",
  numeric: true,
});
const staffRoles = new Set(["faculty", "ta", "staff"]);

function cleanName(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function getUserNames(user) {
  const legalName =
    cleanName(user?.legalName) || cleanName(user?.user?.legalName) || UNKNOWN_USER_NAME;
  const displayName = cleanName(user?.displayName) || cleanName(user?.user?.displayName);

  return {
    legalName,
    displayName,
    distinctDisplayName:
      displayName && nameCollator.compare(displayName, legalName) !== 0
        ? displayName
        : "",
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
      const { legalName, displayName } = getUserNames(user);
      return `${legalName} ${displayName}`.toLocaleLowerCase().includes(normalizedSearch);
    })
    .sort((a, b) => {
      const rankDifference = roleRank(a) - roleRank(b);
      if (rankDifference !== 0) return rankDifference;

      const aNames = getUserNames(a);
      const bNames = getUserNames(b);
      const legalNameDifference = nameCollator.compare(
        aNames.legalName,
        bNames.legalName
      );
      if (legalNameDifference !== 0) return legalNameDifference;

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
    default:
      return `${actor} changed the access of ${target}`;
  }
}
