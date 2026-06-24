import { useNavigate } from "react-router-dom";
import { useAppStore } from "../../stores/appStore";
import { StepIcon, continueBtnClass } from "./shared";

export default function LoginTab({
  courses,
  isLoading,
  isStudent,
  onSwitchToSetup,
  canCreate,
}) {
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
              ? "You haven't been added to any course yet. Ask your instructor to add you to a course."
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
