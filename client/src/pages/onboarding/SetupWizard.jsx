import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAppStore } from "../../stores/appStore";
import { useCreateCourse } from "../../hooks/useCourses";
import {
  StepIcon,
  ErrorMessage,
  useTransientError,
  inputClass,
  continueBtnClass,
  backBtnClass,
} from "./shared";

const WIZARD_STEPS = [
  { number: 1, label: "Course Selection" },
  { number: 2, label: "Course Structure" },
  { number: 3, label: "Course Details" },
];

function StepIndicator({ step }) {
  return (
    <div className="mb-10 flex items-center justify-center gap-4 sm:gap-8">
      {WIZARD_STEPS.map(({ number, label }) => {
        const state =
          number === step ? "active" : number < step ? "completed" : "upcoming";
        return (
          <div key={number} className="flex flex-col items-center gap-2 text-center">
            <div
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold transition-colors ${
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
  );
}

export default function SetupWizard() {
  const navigate = useNavigate();
  const setSelectedCourse = useAppStore((state) => state.setSelectedCourse);
  const [step, setStep] = useState(1);
  const [complete, setComplete] = useState(false);
  const [courseData, setCourseData] = useState({});
  const [error, showError] = useTransientError();

  const createMutation = useCreateCourse({
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
      <StepIndicator step={step} />
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
