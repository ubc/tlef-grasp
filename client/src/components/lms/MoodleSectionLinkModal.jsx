import { useEffect, useState } from "react";
import Modal from "../ui/Modal";
import {
  useAvailableMoodleCourses,
  useLinkMoodleSection,
  useMoodleGroups,
} from "../../hooks/useMoodleIntegration";

const optionClass =
  "flex cursor-pointer items-center gap-3 border-b border-gray-100 px-4 py-3 last:border-b-0 hover:bg-gray-50";

export default function MoodleSectionLinkModal({
  open,
  onClose,
  courseId,
  localSection,
  onLinked,
}) {
  const existingLink = localSection?.lmsLink?.provider === "moodle"
    ? localSection.lmsLink
    : null;
  const localSectionId = localSection?.sectionId || "";
  const [moodleCourseId, setMoodleCourseId] = useState("");
  const [moodleGroupId, setMoodleGroupId] = useState("");

  useEffect(() => {
    if (!open) return;
    setMoodleCourseId(existingLink?.externalCourseId || "");
    setMoodleGroupId(existingLink?.externalSectionId || "");
  }, [
    open,
    existingLink?.externalCourseId,
    existingLink?.externalSectionId,
    localSectionId,
  ]);

  const coursesQuery = useAvailableMoodleCourses(courseId, localSectionId, {
    enabled: open,
  });
  const groupsQuery = useMoodleGroups(
    courseId,
    localSectionId,
    moodleCourseId,
    { enabled: open && !!moodleCourseId }
  );

  useEffect(() => {
    if (groupsQuery.groups.length === 1) {
      setMoodleGroupId(groupsQuery.groups[0].id);
    }
  }, [groupsQuery.groups]);

  const linkMutation = useLinkMoodleSection(courseId, localSectionId, {
    onSuccess: (data) => {
      onLinked?.(data.link);
      onClose?.();
    },
  });

  const groups = groupsQuery.groups;
  const groupSelected =
    groups.length === 1 ||
    (groups.length > 1 && groups.some((group) => group.id === moodleGroupId));
  const canSubmit =
    !!moodleCourseId &&
    groupSelected &&
    !coursesQuery.isPending &&
    !groupsQuery.isPending &&
    !linkMutation.isPending;

  const selectCourse = (id) => {
    setMoodleCourseId(id);
    setMoodleGroupId("");
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Link to Moodle Course"
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!canSubmit}
            onClick={() =>
              linkMutation.mutate({ moodleCourseId, moodleGroupId })
            }
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-dark disabled:opacity-50"
          >
            {linkMutation.isPending ? "Linking…" : "Link Course"}
          </button>
        </>
      }
    >
      <div className="space-y-5">
        <fieldset>
          <legend className="mb-2 text-sm font-semibold text-ink">
            Moodle course
          </legend>
          {coursesQuery.isPending ? (
            <LoadingLine label="Loading Moodle courses…" />
          ) : coursesQuery.isError ? (
            <ErrorBox message={coursesQuery.error?.message} />
          ) : coursesQuery.courses.length === 0 ? (
            <EmptyBox message="No Moodle courses were found for this account." />
          ) : (
            <div className="max-h-56 overflow-y-auto rounded-xl border border-gray-200">
              {coursesQuery.courses.map((course) => (
                <label key={course.id} className={optionClass}>
                  <input
                    type="radio"
                    name="moodle-course"
                    value={course.id}
                    checked={moodleCourseId === course.id}
                    onChange={() => selectCourse(course.id)}
                    className="h-4 w-4 accent-primary"
                  />
                  <span className="text-sm text-ink">
                    <span className="font-medium">{course.name}</span>
                    {course.code ? (
                      <span className="ml-2 text-muted">{course.code}</span>
                    ) : null}
                  </span>
                </label>
              ))}
            </div>
          )}
        </fieldset>

        {moodleCourseId ? (
          <fieldset>
            <legend className="mb-2 text-sm font-semibold text-ink">
              Moodle group
            </legend>
            <p className="mb-2 text-xs text-muted">
              Moodle groups are used as the equivalent of Canvas sections.
            </p>
            {groupsQuery.isPending ? (
              <LoadingLine label="Loading Moodle groups…" />
            ) : groupsQuery.isError ? (
              <ErrorBox message={groupsQuery.error?.message} />
            ) : groups.length === 0 ? (
              <EmptyBox message="This Moodle course has no groups available." />
            ) : groups.length === 1 ? (
              <div className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-ink">
                This course has a single group—{" "}
                <span className="font-semibold">{groups[0].name}</span>. It will be
                used automatically.
              </div>
            ) : (
              <div className="max-h-56 overflow-y-auto rounded-xl border border-gray-200">
                {groups.map((group) => (
                  <label key={group.id} className={optionClass}>
                    <input
                      type="radio"
                      name="moodle-group"
                      value={group.id}
                      checked={moodleGroupId === group.id}
                      onChange={() => setMoodleGroupId(group.id)}
                      className="h-4 w-4 accent-primary"
                    />
                    <span className="text-sm font-medium text-ink">
                      {group.name}
                    </span>
                  </label>
                ))}
              </div>
            )}
          </fieldset>
        ) : null}

        {linkMutation.isError ? (
          <ErrorBox message={linkMutation.error?.message} />
        ) : null}
      </div>
    </Modal>
  );
}

function LoadingLine({ label }) {
  return (
    <div className="rounded-xl border border-gray-200 px-4 py-4 text-sm text-muted">
      <i className="fas fa-spinner fa-spin mr-2 text-primary" /> {label}
    </div>
  );
}

function ErrorBox({ message }) {
  return (
    <div className="rounded-xl border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger">
      {message || "Moodle could not complete the request."}
    </div>
  );
}

function EmptyBox({ message }) {
  return (
    <div className="rounded-xl border border-dashed border-gray-200 px-4 py-4 text-sm text-muted">
      {message}
    </div>
  );
}
