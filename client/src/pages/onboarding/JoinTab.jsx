import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAppStore } from "../../stores/appStore";
import { useJoinCourseByCode } from "../../hooks/useCourses";
import {
  StepIcon,
  ErrorMessage,
  useTransientError,
  inputClass,
  continueBtnClass,
} from "./shared";

export default function JoinTab() {
  const navigate = useNavigate();
  const setSelectedCourse = useAppStore((state) => state.setSelectedCourse);
  const [code, setCode] = useState("");
  const [error, showError] = useTransientError();

  const joinMutation = useJoinCourseByCode({
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
