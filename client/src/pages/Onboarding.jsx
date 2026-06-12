import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useCurrentUser } from "../hooks/useCurrentUser";
import { useAppStore } from "../stores/appStore";

const inputClass =
  "w-full rounded-xl border-2 border-gray-200 bg-white px-4 py-3 text-base text-ink transition-colors placeholder:text-gray-400 focus:border-[#4facfe] focus:outline-none";

const continueBtnClass =
  "min-w-[140px] rounded-xl bg-gradient-to-br from-[#4facfe] to-[#00f2fe] px-6 py-3.5 text-center text-base font-semibold text-white transition-all hover:-translate-y-0.5 hover:shadow-[0_10px_20px_rgba(79,172,254,0.3)] active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-60";

const backBtnClass =
  "min-w-[140px] rounded-xl border-2 border-gray-200 bg-white px-6 py-3.5 text-base font-semibold text-muted transition-all hover:border-gray-300 hover:text-ink";

function ErrorMessage({ message }) {
  if (!message) return null;
  return (
    <div className="mb-4 rounded-lg border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
      {message}
    </div>
  );
}

function StepIcon({ icon }) {
  return (
    <div className="mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-[#4facfe] to-[#00f2fe]">
      <i className={`fas ${icon} text-3xl text-white`} />
    </div>
  );
}

function useTransientError() {
  const [error, setError] = useState(null);
  const timeoutRef = useRef(null);

  const showError = (message) => {
    setError(message);
    clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => setError(null), 5000);
  };

  useEffect(() => () => clearTimeout(timeoutRef.current), []);
  return [error, showError];
}

function LoginTab({ courses, isLoading, isStudent, onSwitchToSetup, canCreate }) {
  const navigate = useNavigate();
  const setSelectedCourse = useAppStore((state) => state.setSelectedCourse);

  const accessCourse = (course) => {
    setSelectedCourse({ id: course._id, name: course.courseName });
    navigate(isStudent ? "/student-dashboard" : "/dashboard");
  };

  return (
    <div className="text-center">
      <StepIcon icon="fa-sign-in-alt" />
      <h2 className="text-2xl font-bold text-ink">Welcome Back</h2>
      <p className="mt-1 mb-8 text-muted">Select your course to access your dashboard</p>

      {isLoading ? (
        <div className="flex items-center justify-center gap-3 py-8 text-muted">
          <i className="fas fa-spinner fa-spin text-xl" />
          <span>Loading your courses...</span>
        </div>
      ) : courses.length > 0 ? (
        <div className="flex flex-col gap-4">
          {courses.map((course) => (
            <div
              key={course._id}
              className="flex items-center gap-4 rounded-2xl border-2 border-gray-100 bg-white p-5 text-left transition-all hover:-translate-y-0.5 hover:border-[#4facfe]/40 hover:shadow-lg"
            >
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#4facfe] to-[#00f2fe]">
                <i className="fas fa-graduation-cap text-xl text-white" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-lg font-semibold text-ink">
                  {course.courseName}
                </div>
                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
                  <span>
                    <i className="fas fa-user mr-1" /> {course.instructorName}
                  </span>
                  <span>
                    <i className="fas fa-calendar mr-1" /> {course.semester}
                  </span>
                  <span>
                    <i className="fas fa-users mr-1" /> {course.expectedStudents} students
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => accessCourse(course)}
                className="flex shrink-0 items-center gap-2 rounded-xl bg-gradient-to-br from-[#4facfe] to-[#00f2fe] px-5 py-2.5 font-semibold text-white transition-all hover:-translate-y-0.5 hover:shadow-[0_6px_15px_rgba(79,172,254,0.3)]"
                title="Access Dashboard"
              >
                <i className="fas fa-arrow-right" />
                <span>Access</span>
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="py-6">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gray-100">
            <i className="fas fa-graduation-cap text-2xl text-gray-400" />
          </div>
          <h3 className="text-xl font-semibold text-ink">
            {isStudent ? "No Course Found" : "No Courses Found"}
          </h3>
          <p className="mx-auto mt-2 max-w-md text-muted">
            {isStudent
              ? 'You haven\'t been added to any course yet. Ask your instructor for an enrollment code, then use the "Join a course" tab to enroll.'
              : canCreate
                ? 'You don\'t have any courses set up yet. Please use the "New Course Setup" tab to create your first course.'
                : "You don't have any courses set up yet. Please contact a faculty member to add you to a course."}
          </p>
          {canCreate && (
            <button
              type="button"
              onClick={onSwitchToSetup}
              className={`${continueBtnClass} mt-6 inline-flex items-center gap-2`}
            >
              <i className="fas fa-plus" />
              Create New Course
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function JoinTab() {
  const navigate = useNavigate();
  const setSelectedCourse = useAppStore((state) => state.setSelectedCourse);
  const [code, setCode] = useState("");
  const [error, showError] = useTransientError();

  const joinMutation = useMutation({
    mutationFn: (enrollmentCode) =>
      api.post("/api/courses/join-by-code", { enrollmentCode }),
    onSuccess: (data) => {
      setSelectedCourse({ id: data.course._id, name: data.course.courseName });
      navigate("/student-dashboard");
    },
    onError: (err) => showError(err.message || "Could not join course."),
  });

  const submit = () => {
    const trimmed = code.trim();
    if (!trimmed) {
      showError("Enter the enrollment code from your instructor.");
      return;
    }
    joinMutation.mutate(trimmed);
  };

  return (
    <div className="text-center">
      <StepIcon icon="fa-key" />
      <h2 className="text-2xl font-bold text-ink">Join a course</h2>
      <ErrorMessage message={error} />
      <p className="mt-1 mb-8 text-muted">
        Enter the enrollment code your instructor shared with you.
      </p>

      <div className="mx-auto max-w-md text-left">
        <label htmlFor="join-enrollment-code" className="mb-2 block font-semibold text-ink">
          Enrollment code
        </label>
        <input
          id="join-enrollment-code"
          type="text"
          className={inputClass}
          placeholder="Paste or type your code"
          autoComplete="off"
          spellCheck={false}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit();
            }
          }}
        />
      </div>

      <div className="mt-8">
        <button
          type="button"
          onClick={submit}
          disabled={joinMutation.isPending}
          className={continueBtnClass}
        >
          {joinMutation.isPending ? (
            <>
              <i className="fas fa-spinner fa-spin mr-2" /> Joining...
            </>
          ) : (
            <>
              <i className="fas fa-check mr-2" /> Join course
            </>
          )}
        </button>
      </div>
    </div>
  );
}

const WIZARD_STEPS = [
  { number: 1, label: "Course Selection" },
  { number: 2, label: "Course Structure" },
  { number: 3, label: "Course Details" },
];

function SetupWizard() {
  const navigate = useNavigate();
  const setSelectedCourse = useAppStore((state) => state.setSelectedCourse);
  const [step, setStep] = useState(1);
  const [complete, setComplete] = useState(false);
  const [courseData, setCourseData] = useState({});
  const [error, showError] = useTransientError();

  const createMutation = useMutation({
    mutationFn: (payload) => api.post("/api/courses/new", payload),
    onSuccess: (result) => {
      setSelectedCourse({ id: result.course._id, name: result.course.courseName });
      setComplete(true);
    },
    onError: (err) =>
      showError(err.message || "Failed to save course profile. Please try again."),
  });

  const handleSelection = (event) => {
    event.preventDefault();
    const form = new FormData(event.target);
    const courseCode = form.get("customCourseCode")?.trim();
    const courseName = form.get("customCourseName")?.trim();
    if (!courseCode || !courseName) {
      showError("Please provide both course code and name");
      return;
    }
    setCourseData((prev) => ({ ...prev, courseCode, courseName }));
    setStep(2);
  };

  const handleStructure = (event) => {
    event.preventDefault();
    const form = new FormData(event.target);
    const courseWeeks = parseInt(form.get("courseWeeks"), 10);
    const lecturesPerWeek = parseInt(form.get("lecturesPerWeek"), 10);
    const courseCredits = parseInt(form.get("courseCredits"), 10);
    if (!courseWeeks || !lecturesPerWeek || !courseCredits) {
      showError("Please fill in all required fields");
      return;
    }
    setCourseData((prev) => ({ ...prev, courseWeeks, lecturesPerWeek, courseCredits }));
    setStep(3);
  };

  const handleDetails = (event) => {
    event.preventDefault();
    const form = new FormData(event.target);
    const instructorName = form.get("instructorName")?.trim();
    const semester = form.get("semester")?.trim();
    const expectedStudents = parseInt(form.get("expectedStudents"), 10);
    const courseDescription = form.get("courseDescription") || "";

    if (!instructorName || !semester || isNaN(expectedStudents) || expectedStudents <= 0) {
      showError("Please fill in all required fields with valid values");
      return;
    }
    if (!courseData.courseCode || !courseData.courseName) {
      showError(
        "Course code and name are missing. Please go back to step 1 and select a course."
      );
      return;
    }

    createMutation.mutate({
      ...courseData,
      instructorName,
      semester,
      expectedStudents,
      courseDescription,
      status: "active",
      createdAt: new Date().toISOString(),
    });
  };

  if (complete) {
    return (
      <div className="text-center">
        <div className="mb-5">
          <i className="fas fa-check-circle text-7xl text-success" />
        </div>
        <h2 className="text-2xl font-bold text-ink">Welcome to GRASP!</h2>
        <p className="mx-auto mt-2 mb-8 max-w-md text-muted">
          Your course has been successfully set up. You can now start uploading
          materials and generating questions.
        </p>
        <button
          type="button"
          onClick={() => navigate("/dashboard")}
          className={continueBtnClass}
        >
          Go to Dashboard
        </button>
      </div>
    );
  }

  return (
    <div>
      {/* Progress indicator */}
      <div className="mb-10 flex items-center justify-center gap-8">
        {WIZARD_STEPS.map(({ number, label }) => {
          const state =
            number === step ? "active" : number < step ? "completed" : "upcoming";
          return (
            <div key={number} className="flex flex-col items-center gap-2">
              <div
                className={`flex h-10 w-10 items-center justify-center rounded-full text-sm font-bold transition-colors ${
                  state === "active"
                    ? "bg-gradient-to-br from-[#4facfe] to-[#00f2fe] text-white"
                    : state === "completed"
                      ? "bg-success text-white"
                      : "bg-gray-200 text-muted"
                }`}
              >
                {state === "completed" ? <i className="fas fa-check" /> : number}
              </div>
              <span
                className={`text-xs font-medium ${
                  state === "active" ? "text-ink" : "text-muted"
                }`}
              >
                {label}
              </span>
            </div>
          );
        })}
      </div>

      <ErrorMessage message={error} />

      {step === 1 && (
        <div className="text-center">
          <StepIcon icon="fa-bullseye" />
          <h2 className="text-2xl font-bold text-ink">Course Setup</h2>
          <p className="mt-1 mb-8 text-muted">Create your new course</p>
          <form onSubmit={handleSelection} className="mx-auto max-w-md space-y-5 text-left">
            <div>
              <label htmlFor="custom-course-code" className="mb-2 block font-semibold text-ink">
                Course Code
              </label>
              <input
                id="custom-course-code"
                name="customCourseCode"
                type="text"
                placeholder="e.g., MATH 101"
                required
                defaultValue={courseData.courseCode || ""}
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor="custom-course-name" className="mb-2 block font-semibold text-ink">
                Course Name
              </label>
              <input
                id="custom-course-name"
                name="customCourseName"
                type="text"
                placeholder="e.g., Introduction to Calculus"
                required
                defaultValue={courseData.courseName || ""}
                className={inputClass}
              />
            </div>
            <div className="pt-2 text-center">
              <button type="submit" className={continueBtnClass}>
                Continue Setup
              </button>
            </div>
          </form>
        </div>
      )}

      {step === 2 && (
        <div className="text-center">
          <StepIcon icon="fa-calendar-alt" />
          <h2 className="text-2xl font-bold text-ink">Course Structure</h2>
          <p className="mt-1 mb-8 text-muted">
            Setting up: <span className="font-semibold text-ink">{courseData.courseName}</span>
          </p>
          <form onSubmit={handleStructure} className="mx-auto max-w-md space-y-5 text-left">
            <div>
              <label htmlFor="course-weeks" className="mb-2 block font-semibold text-ink">
                How many weeks is the course?
              </label>
              <input
                id="course-weeks"
                name="courseWeeks"
                type="number"
                min="1"
                max="52"
                placeholder="e.g., 12"
                required
                defaultValue={courseData.courseWeeks || ""}
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor="lectures-per-week" className="mb-2 block font-semibold text-ink">
                How many lectures per week?
              </label>
              <input
                id="lectures-per-week"
                name="lecturesPerWeek"
                type="number"
                min="1"
                max="7"
                placeholder="e.g., 3"
                required
                defaultValue={courseData.lecturesPerWeek || ""}
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor="course-credits" className="mb-2 block font-semibold text-ink">
                Course Credits
              </label>
              <select
                id="course-credits"
                name="courseCredits"
                required
                defaultValue={courseData.courseCredits || ""}
                className={inputClass}
              >
                <option value="">Select credits...</option>
                <option value="1">1 Credit</option>
                <option value="2">2 Credits</option>
                <option value="3">3 Credits</option>
                <option value="4">4 Credits</option>
                <option value="6">6 Credits</option>
              </select>
            </div>
            <div className="flex justify-center gap-4 pt-2">
              <button type="button" onClick={() => setStep(1)} className={backBtnClass}>
                Back
              </button>
              <button type="submit" className={continueBtnClass}>
                Create Course Structure
              </button>
            </div>
          </form>
        </div>
      )}

      {step === 3 && (
        <div className="text-center">
          <StepIcon icon="fa-graduation-cap" />
          <h2 className="text-2xl font-bold text-ink">Course Details</h2>
          <p className="mt-1 mb-8 text-muted">Finalize your course profile</p>
          <form onSubmit={handleDetails} className="mx-auto max-w-md space-y-5 text-left">
            <div>
              <label htmlFor="instructor-name" className="mb-2 block font-semibold text-ink">
                Instructor Name
              </label>
              <input
                id="instructor-name"
                name="instructorName"
                type="text"
                placeholder="e.g., Dr. Smith"
                required
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor="semester" className="mb-2 block font-semibold text-ink">
                Semester
              </label>
              <select id="semester" name="semester" required defaultValue="" className={inputClass}>
                <option value="">Select semester...</option>
                <option value="Fall 2024">Fall 2024</option>
                <option value="Spring 2025">Spring 2025</option>
                <option value="Summer 2025">Summer 2025</option>
                <option value="Fall 2025">Fall 2025</option>
              </select>
            </div>
            <div>
              <label htmlFor="expected-students" className="mb-2 block font-semibold text-ink">
                Expected Number of Students
              </label>
              <input
                id="expected-students"
                name="expectedStudents"
                type="number"
                min="1"
                max="1000"
                placeholder="e.g., 45"
                required
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor="course-description" className="mb-2 block font-semibold text-ink">
                Course Description (Optional)
              </label>
              <textarea
                id="course-description"
                name="courseDescription"
                rows={4}
                placeholder="Brief description of the course content and objectives..."
                className={inputClass}
              />
            </div>
            <div className="flex justify-center gap-4 pt-2">
              <button type="button" onClick={() => setStep(2)} className={backBtnClass}>
                Back
              </button>
              <button type="submit" disabled={createMutation.isPending} className={continueBtnClass}>
                {createMutation.isPending ? "Saving..." : "Complete Setup"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

export default function Onboarding() {
  const navigate = useNavigate();
  const { user, isFaculty, isStudent } = useCurrentUser();
  const selectedCourse = useAppStore((state) => state.selectedCourse);

  // If the user arrived already onboarded, send them to their dashboard
  // (mirrors onboarding-check.js — but don't redirect mid-flow after creating/joining).
  const wasOnboardedOnMount = useRef(!!selectedCourse);
  useEffect(() => {
    if (wasOnboardedOnMount.current && user) {
      navigate(isStudent ? "/student-dashboard" : "/dashboard", { replace: true });
    }
  }, [user, isStudent, navigate]);

  const coursesQuery = useQuery({
    queryKey: ["my-courses", "onboarding"],
    queryFn: () => api.get("/api/courses/my"),
    enabled: !!user,
  });
  const courses = coursesQuery.data?.courses || [];

  const [activeTab, setActiveTab] = useState(null);

  // Pick the initial tab once the course list arrives (legacy determineInitialTab)
  useEffect(() => {
    if (activeTab !== null || !user || coursesQuery.isPending) return;
    const hasCourses = courses.length > 0;
    if (isStudent) {
      setActiveTab(hasCourses ? "login" : "join");
    } else if (isFaculty) {
      setActiveTab(hasCourses ? "login" : "setup");
    } else {
      setActiveTab("login");
    }
  }, [activeTab, user, coursesQuery.isPending, courses.length, isStudent, isFaculty]);

  const tabs = [
    ...(isFaculty ? [{ id: "setup", label: "New Course Setup" }] : []),
    { id: "login", label: "Login to Existing Dashboard" },
    ...(isStudent ? [{ id: "join", label: "Join a course" }] : []),
  ];

  document.title = "GRASP - Onboarding";

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#667eea] to-[#764ba2] px-5 py-10">
      <div className="mx-auto w-full max-w-[700px]">
        {/* Tab navigation */}
        <div className="mb-5 flex justify-center gap-2">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`rounded-t-xl px-6 py-3 text-sm font-semibold transition-colors ${
                activeTab === tab.id
                  ? "bg-white text-ink"
                  : "bg-white/20 text-white hover:bg-white/30"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Card */}
        <div className="relative overflow-hidden rounded-[20px] bg-white p-10 shadow-[0_20px_40px_rgba(0,0,0,0.1)]">
          <div className="absolute top-0 right-0 left-0 h-1 bg-gradient-to-r from-[#4facfe] to-[#00f2fe]" />
          {activeTab === null ? (
            <div className="flex items-center justify-center gap-3 py-8 text-muted">
              <i className="fas fa-spinner fa-spin text-xl" />
              <span>Loading...</span>
            </div>
          ) : activeTab === "login" ? (
            <LoginTab
              courses={courses}
              isLoading={coursesQuery.isPending}
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
