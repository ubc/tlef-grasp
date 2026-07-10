import { useEffect, useRef } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useCurrentUser } from "../../hooks/useCurrentUser";
import { useMyCourses } from "../../hooks/useCourses";
import { useCoInstructorAccess } from "../../hooks/useCoInstructorAccess";
import { useAppStore } from "../../stores/appStore";
import { useToast } from "../ui/Toast";
import { PATH_PERMISSION } from "../../lib/permissions";

const INSTRUCTOR_ITEMS = [
  { to: "/dashboard", icon: "fa-home", label: "Dashboard" },
  { to: "/course-materials", icon: "fa-upload", label: "Course Materials" },
  { to: "/question-generation", icon: "fa-wand-magic-sparkles", label: "Question Generation" },
  { to: "/question-bank", icon: "fa-book", label: "Question Bank" },
  { to: "/quizzes", icon: "fa-clipboard-list", label: "Quizzes" },
  { to: "/quiz-scores", icon: "fa-chart-bar", label: "Quiz Scores" },
  { to: "/question-flags", icon: "fa-flag", label: "Question Flags" },
];

const INSTRUCTOR_MANAGEMENT_ITEMS = [
  { to: "/my-sections", icon: "fa-layer-group", label: "My Sections" },
];

const STUDENT_ITEMS = [
  { to: "/student-dashboard", icon: "fa-home", label: "Dashboard" },
  { to: "/quiz", icon: "fa-list-check", label: "My Quizzes" },
  { to: "/achievements", icon: "fa-trophy", label: "Achievements" },
  { to: "/my-question-flags", icon: "fa-flag", label: "My Flagged Questions" },
];

function NavItem({ to, icon, label }) {
  return (
    <li>
      <NavLink
        to={to}
        className={({ isActive }) =>
          `mb-2 flex items-center gap-[15px] rounded-[10px] px-5 py-[15px] text-[15px] font-medium tracking-[-0.2px] transition-all duration-300 ${
            isActive
              ? "bg-primary text-white shadow-[0_4px_15px_rgba(52,152,219,0.3)]"
              : "text-white/90 hover:translate-x-[5px] hover:bg-white/10"
          }`
        }
      >
        {({ isActive }) => (
          <>
            <i className={`fas ${icon} w-5 text-center text-lg ${isActive ? "text-white" : "text-white/80"}`} />
            <span className={isActive ? "font-semibold" : ""}>{label}</span>
          </>
        )}
      </NavLink>
    </li>
  );
}

function CourseSelector() {
  const { isStudent } = useCurrentUser();
  const { courses, isLoading, isError } = useMyCourses();
  const { selectedCourse, setSelectedCourse } = useAppStore();
  const queryClient = useQueryClient();

  // Keep the session course in sync with what the API says the user can access
  useEffect(() => {
    if (isLoading || isError) return;

    if (courses.length === 0) {
      // No courses (all deleted, or removed from the course) — drop any stale
      // selection so the onboarding guard sends the user back to onboarding.
      if (selectedCourse) setSelectedCourse(null);
      return;
    }

    const stillValid =
      selectedCourse && courses.some((course) => course.id === selectedCourse.id);

    if (!stillValid) {
      setSelectedCourse(courses[0]);
    }
  }, [courses, isLoading, isError, isStudent, selectedCourse, setSelectedCourse]);

  const handleChange = (event) => {
    const course = courses.find((c) => c.id === event.target.value);
    if (course) {
      setSelectedCourse(course);
      // Refetch all course-scoped data instead of the legacy full page reload
      queryClient.invalidateQueries();
    }
  };

  return (
    <div className="border-b border-white/10 px-[25px] pb-[25px]">
      <label className="mb-2 block text-xs text-white/70">Current Course:</label>
      {isLoading ? (
        <div className="text-lg font-semibold text-white">Loading...</div>
      ) : isError ? (
        <div className="italic text-white/50">Error loading courses</div>
      ) : courses.length === 0 ? (
        <div className="italic text-white/50">No course available</div>
      ) : courses.length === 1 ? (
        <div className="break-words text-lg font-semibold text-white">
          {courses[0].name}
        </div>
      ) : (
        <select
          aria-label="Select a course"
          value={selectedCourse?.id || ""}
          onChange={handleChange}
          className="w-full cursor-pointer appearance-none rounded-lg border border-white/20 bg-white/10 px-3 py-2.5 text-sm font-medium text-white transition-all hover:border-white/30 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 [&>option]:bg-sidebar-from [&>option]:text-white"
        >
          <option value="">Select a course...</option>
          {courses.map((course) => (
            <option key={course.id} value={course.id}>
              {course.name}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

export default function Sidebar({ open = false, onClose }) {
  const closeButtonRef = useRef(null);
  const { isStudent, isFaculty } = useCurrentUser();
  const { can } = useCoInstructorAccess();
  const { currentRole, setCurrentRole, selectedCourse, setSelectedCourse } =
    useAppStore();
  const navigate = useNavigate();
  const showToast = useToast();

  // Students can only ever see the student view
  const viewingStudent = isStudent || currentRole === "student";
  // Students without a course only get the Dashboard link (legacy behavior)
  const studentItems =
    isStudent && !selectedCourse ? STUDENT_ITEMS.slice(0, 1) : STUDENT_ITEMS;

  // Hide instructor links a co-instructor isn't permitted to see. Items without
  // a gating permission (Dashboard, Quizzes, Quiz Scores) are always shown.
  const instructorItems = INSTRUCTOR_ITEMS.filter((item) => {
    const permission = PATH_PERMISSION[item.to];
    return !permission || can(permission);
  });

  const handleRoleSwitch = () => {
    const nextRole = currentRole === "instructor" ? "student" : "instructor";
    setCurrentRole(nextRole);
    navigate(nextRole === "student" ? "/student-dashboard" : "/dashboard");
    showToast(`Switched to ${nextRole} view`, "success");
  };

  const handleSignOut = () => {
    setSelectedCourse(null);
    window.location.href = "/auth/logout";
  };

  // When the drawer opens (mobile only — on desktop `open` stays false), move
  // focus to its close control so keyboard users land inside the drawer.
  useEffect(() => {
    if (open) closeButtonRef.current?.focus();
  }, [open]);

  return (
    <aside
      className={`fixed top-0 left-0 z-[1000] h-screen w-[280px] overflow-y-auto bg-gradient-to-b from-sidebar-from to-sidebar-to text-white shadow-[2px_0_10px_rgba(0,0,0,0.1)] transition-transform duration-300 lg:visible lg:translate-x-0 ${
        open ? "visible translate-x-0" : "invisible -translate-x-full"
      }`}
    >
      <nav className="flex h-full flex-col">
        {/* Logo */}
        <div className="mb-5 border-b border-white/10 px-[25px] pt-[30px] pb-[25px]">
          <div className="flex items-center justify-between gap-3 text-2xl font-bold tracking-[-0.5px]">
            <div className="flex items-center gap-3">
              <i className="fas fa-graduation-cap text-[28px] text-[#5dade2]" />
              <span>GRASP</span>
            </div>
            <button
              ref={closeButtonRef}
              type="button"
              onClick={onClose}
              aria-label="Close navigation menu"
              className="flex h-9 w-9 items-center justify-center rounded-lg text-white/80 transition-colors hover:bg-white/10 lg:hidden"
            >
              <i className="fas fa-times text-lg" />
            </button>
          </div>
        </div>

        {/* User controls */}
        <div className="mb-[25px] flex justify-center gap-3 border-b border-white/10 px-[25px] pb-[25px]">
          <Link
            to="/profile"
            className="relative flex h-[45px] w-[45px] items-center justify-center rounded-full bg-white/10 transition-all hover:-translate-y-0.5 hover:bg-white/20"
            aria-label="Profile"
            title="Profile"
          >
            <i className="fas fa-user-circle text-lg text-white/90" />
          </Link>
          {!isStudent && can("settings") && (
            <Link
              to="/settings"
              className="relative flex h-[45px] w-[45px] items-center justify-center rounded-full bg-white/10 transition-all hover:-translate-y-0.5 hover:bg-white/20"
              aria-label="Settings"
              title="Settings"
            >
              <i className="fas fa-cog text-lg text-white/90" />
            </Link>
          )}
        </div>

        {/* Course selector */}
        <div className="mb-[25px]">
          <CourseSelector />
        </div>

        {/* Navigation */}
        <div className="flex-1 px-[25px] pb-[25px]">
          <ul>
            {(viewingStudent ? studentItems : instructorItems).map((item) => (
              <NavItem key={item.to} {...item} />
            ))}
          </ul>
          {!viewingStudent && (
            <>
              <div className="my-3 border-t border-white/10" />
              <p className="mb-2 px-2 text-[11px] font-semibold uppercase tracking-widest text-white/40">
                Management
              </p>
              <ul>
                {INSTRUCTOR_MANAGEMENT_ITEMS.map((item) => (
                  <NavItem key={item.to} {...item} />
                ))}
                {isFaculty && (
                  <NavItem to="/users" icon="fa-users" label="Users" />
                )}
                {can("settings") && (
                  <NavItem to="/settings" icon="fa-cog" label="Settings" />
                )}
              </ul>
            </>
          )}
        </div>

        {/* Role switch + sign out */}
        <div className="mt-auto border-t border-white/10 p-[25px]">
          {!isStudent && (
            <button
              type="button"
              onClick={handleRoleSwitch}
              className="mb-2.5 flex w-full items-center justify-center gap-2 rounded-lg border border-white/20 bg-white/10 px-4 py-3 text-sm font-medium text-white transition-all hover:-translate-y-px hover:border-white/30 hover:bg-white/20"
            >
              <i className="fas fa-exchange-alt" />
              <span>Switch View</span>
            </button>
          )}
          <div className="text-center text-xs text-white/70">
            {isStudent ? (
              <span>
                Role: <strong className="font-semibold text-white/90">Student</strong>
              </span>
            ) : (
              <span>
                Viewing:{" "}
                <strong className="font-semibold text-white/90">
                  {viewingStudent ? "Student" : "Instructor"}
                </strong>
              </span>
            )}
          </div>
          {/* Brighter red than the danger token — it sits on the dark sidebar */}
          <button
            type="button"
            onClick={handleSignOut}
            className="mt-[15px] flex w-full items-center justify-center gap-2 rounded-lg border border-[#e74c3c]/50 bg-[#e74c3c]/20 px-4 py-3 text-sm font-medium text-[#f5b7b1] transition-all hover:-translate-y-px hover:border-[#e74c3c]/70 hover:bg-[#e74c3c]/30"
          >
            <i className="fas fa-sign-out-alt" />
            <span>Sign Out</span>
          </button>
        </div>
      </nav>
    </aside>
  );
}
