import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useCurrentUser } from "../hooks/useCurrentUser";
import { useMyCourseProfiles } from "../hooks/useCourses";
import { useAppStore } from "../stores/appStore";
import LoginTab from "./onboarding/LoginTab";
import JoinTab from "./onboarding/JoinTab";
import SetupWizard from "./onboarding/SetupWizard";

export default function Onboarding() {
  const navigate = useNavigate();
  const { user, isFaculty, isStaff, isStudent } = useCurrentUser();
  const selectedCourse = useAppStore((state) => state.selectedCourse);
  const setSelectedCourse = useAppStore((state) => state.setSelectedCourse);

  const { courses, isPending: coursesPending } = useMyCourseProfiles();

  // If the user arrived already onboarded (a still-valid course is selected),
  // send them straight to their dashboard. Decide only once the real course
  // list has loaded, so a selection left over from a now-deleted course (e.g.
  // after a DB reset) is cleared instead of bouncing to a "No course available"
  // page. The ref ensures we act on the first settled load only — never
  // mid-flow after creating/joining a course.
  const redirectDecided = useRef(false);
  useEffect(() => {
    if (redirectDecided.current || !user || coursesPending) return;
    redirectDecided.current = true;

    const validSelection =
      selectedCourse &&
      courses.some((c) => (c._id || c.id) === selectedCourse.id);

    if (validSelection) {
      navigate(isStudent ? "/student-dashboard" : "/dashboard", { replace: true });
    } else if (selectedCourse) {
      setSelectedCourse(null);
    }
  }, [user, coursesPending, courses, selectedCourse, isStudent, navigate, setSelectedCourse]);

  const [activeTab, setActiveTab] = useState(null);

  // Enrollment-code "Join a course" is for faculty, staff, and administrators
  // (admins are reported as faculty by the API), not students.
  const canJoinByCode = isFaculty || isStaff;

  // Pick the initial tab once the course list arrives (legacy determineInitialTab)
  useEffect(() => {
    if (activeTab !== null || !user || coursesPending) return;
    const hasCourses = courses.length > 0;
    if (isStudent) {
      setActiveTab("login");
    } else if (isFaculty) {
      setActiveTab(hasCourses ? "login" : "setup");
    } else {
      setActiveTab("login");
    }
  }, [activeTab, user, coursesPending, courses.length, isStudent, isFaculty]);

  const tabs = [
    ...(isFaculty ? [{ id: "setup", label: "New Course Setup" }] : []),
    { id: "login", label: "Login to Existing Dashboard" },
    ...(canJoinByCode ? [{ id: "join", label: "Join a course" }] : []),
  ];

  useEffect(() => {
    document.title = "GRASP - Onboarding";
  }, []);

  const handleSignOut = () => {
    setSelectedCourse(null);
    window.location.href = "/auth/logout";
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#667eea] to-[#764ba2] px-5 py-10">
      <div className="mx-auto w-full max-w-[700px]">
        {/* Sign out */}
        <div className="mb-4 flex justify-end">
          <button
            type="button"
            onClick={handleSignOut}
            className="inline-flex items-center gap-2 rounded-lg bg-white/20 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-white/30"
          >
            <i className="fas fa-sign-out-alt" />
            Sign Out
          </button>
        </div>

        {/* Tab navigation */}
        <div className="flex flex-wrap justify-center gap-2">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`rounded-t-xl px-4 py-2.5 text-sm font-semibold transition-colors sm:px-6 sm:py-3 ${activeTab === tab.id
                ? "bg-white text-ink"
                : "bg-white/20 text-white hover:bg-white/30"
                }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Card */}
        <div className="relative overflow-hidden rounded-[20px] bg-white p-6 shadow-[0_20px_40px_rgba(0,0,0,0.1)] sm:p-10">
          <div className="absolute top-0 right-0 left-0 h-1 bg-gradient-to-r from-[#4facfe] to-[#00f2fe]" />
          {activeTab === null ? (
            <div className="flex items-center justify-center gap-3 py-8 text-muted">
              <i className="fas fa-spinner fa-spin text-xl" />
              <span>Loading...</span>
            </div>
          ) : activeTab === "login" ? (
            <LoginTab
              courses={courses}
              isLoading={coursesPending}
              isStudent={isStudent}
              canCreate={isFaculty}
              onSwitchToSetup={() => setActiveTab("setup")}
            />
          ) : activeTab === "join" ? (
            <JoinTab />
          ) : (
            <SetupWizard />
          )}
        </div>
      </div>
    </div>
  );
}
