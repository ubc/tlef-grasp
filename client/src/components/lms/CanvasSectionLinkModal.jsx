import { useEffect, useState } from "react";
import Modal from "../ui/Modal";
import {
  useAvailableCanvasCourses,
  useCanvasSections,
  useLinkCanvasSection,
} from "../../hooks/useCanvasIntegration";

const optionClass =
  "flex cursor-pointer items-center gap-3 border-b border-gray-100 px-4 py-3 last:border-b-0 hover:bg-gray-50";

export default function CanvasSectionLinkModal({
  open,
  onClose,
  courseId,
  localSection,
  onLinked,
}) {
  const existingLink = localSection?.lmsLink?.provider === "canvas"
    ? localSection.lmsLink
    : null;
  const localSectionId = localSection?.sectionId || "";
  const [canvasCourseId, setCanvasCourseId] = useState("");
  const [canvasSectionId, setCanvasSectionId] = useState("");

  useEffect(() => {
    if (!open) return;
    setCanvasCourseId(existingLink?.externalCourseId || "");
    setCanvasSectionId(existingLink?.externalSectionId || "");
  }, [
    open,
    existingLink?.externalCourseId,
    existingLink?.externalSectionId,
    localSectionId,
  ]);

  const coursesQuery = useAvailableCanvasCourses(courseId, localSectionId, {
    enabled: open,
  });
  const sectionsQuery = useCanvasSections(
    courseId,
    localSectionId,
    canvasCourseId,
    { enabled: open && !!canvasCourseId }
  );

  useEffect(() => {
    if (sectionsQuery.sections.length === 1) {
      setCanvasSectionId(sectionsQuery.sections[0].id);
    }
  }, [sectionsQuery.sections]);

  const linkMutation = useLinkCanvasSection(courseId, localSectionId, {
    onSuccess: (data) => {
      onLinked?.(data.link);
      onClose?.();
    },
  });

  const sections = sectionsQuery.sections;
  const sectionSelected =
    sections.length === 1 ||
    (sections.length > 1 && sections.some((section) => section.id === canvasSectionId));
  const canSubmit =
    !!canvasCourseId &&
    sectionSelected &&
    !coursesQuery.isPending &&
    !sectionsQuery.isPending &&
    !linkMutation.isPending;

  const selectCourse = (id) => {
    setCanvasCourseId(id);
    setCanvasSectionId("");
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Link to Canvas Course"
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
              linkMutation.mutate({ canvasCourseId, canvasSectionId })
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
            Canvas course
          </legend>
          {coursesQuery.isPending ? (
            <LoadingLine label="Loading Canvas courses…" />
          ) : coursesQuery.isError ? (
            <ErrorBox message={coursesQuery.error?.message} />
          ) : coursesQuery.courses.length === 0 ? (
            <EmptyBox message="No Canvas courses were found for this instructor account." />
          ) : (
            <div className="max-h-56 overflow-y-auto rounded-xl border border-gray-200">
              {coursesQuery.courses.map((course) => (
                <label key={course.id} className={optionClass}>
                  <input
                    type="radio"
                    name="canvas-course"
                    value={course.id}
                    checked={canvasCourseId === course.id}
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

        {canvasCourseId ? (
          <fieldset>
            <legend className="mb-2 text-sm font-semibold text-ink">Section</legend>
            {sectionsQuery.isPending ? (
              <LoadingLine label="Loading Canvas sections…" />
            ) : sectionsQuery.isError ? (
              <ErrorBox message={sectionsQuery.error?.message} />
            ) : sections.length === 0 ? (
              <EmptyBox message="This Canvas course has no sections available." />
            ) : sections.length === 1 ? (
              <div className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-ink">
                This course has a single section—{" "}
                <span className="font-semibold">{sections[0].name}</span>. It will
                be used automatically.
              </div>
            ) : (
              <div className="max-h-56 overflow-y-auto rounded-xl border border-gray-200">
                {sections.map((section) => (
                  <label key={section.id} className={optionClass}>
                    <input
                      type="radio"
                      name="canvas-section"
                      value={section.id}
                      checked={canvasSectionId === section.id}
                      onChange={() => setCanvasSectionId(section.id)}
                      className="h-4 w-4 accent-primary"
                    />
                    <span className="text-sm font-medium text-ink">
                      {section.name}
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
      {message || "Canvas could not complete the request."}
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
