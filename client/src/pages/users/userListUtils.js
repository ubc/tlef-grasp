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
