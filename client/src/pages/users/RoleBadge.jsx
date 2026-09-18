// Course-role pill shared by the roster and the add-people picker.
export default function RoleBadge({ role }) {
  const config = {
    faculty: {
      icon: "fa-graduation-cap",
      label: "Faculty",
      classes: "bg-purple-100 text-purple-700",
    },
    ta: {
      icon: "fa-chalkboard-teacher",
      label: "TA",
      classes: "bg-amber-100 text-amber-700",
    },
    staff: { icon: "fa-user-tie", label: "Staff", classes: "bg-blue-100 text-blue-700" },
    student: {
      icon: "fa-user-graduate",
      label: "Student",
      classes: "bg-green-100 text-green-700",
    },
  }[role];
  if (!config) return null;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${config.classes}`}
    >
      <i className={`fas ${config.icon}`} /> {config.label}
    </span>
  );
}
