import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { queryKeys } from "../lib/queryKeys";
import { useCurrentUser } from "./useCurrentUser";
import { useCourse } from "./useSections";
import { useSelectedCourseId } from "../stores/appStore";
import { courseLabel } from "../lib/academicPeriod";

// Courses the current user can access, normalized to { id, name, label }.
// `label` is the one-line switcher string (name + nickname + academic period);
// `name` stays the bare course name for everything that just needs to say which
// course is selected. Students and staff use different endpoints.
// The server returns them in the user's own saved order.
export function useMyCourses() {
  const { user, isStudent } = useCurrentUser();

  const query = useQuery({
    queryKey: queryKeys.myCourses(isStudent ? "student" : "staff"),
    queryFn: () =>
      api.get(isStudent ? "/api/student/courses" : "/api/courses/my"),
    enabled: !!user,
  });

  return {
    ...query,
    courses: (query.data?.courses || []).map((course) => {
      const normalized = {
        ...course,
        id: course._id || course.id,
        name: course.name || course.courseName || "Unknown Course",
      };
      return { ...normalized, label: courseLabel(normalized) };
    }),
  };
}

// Raw course profiles from /api/courses/my (courseName, instructorName,
// semester, ...). Used by onboarding, which shows the full profile.
export function useMyCourseProfiles() {
  const { user } = useCurrentUser();

  const query = useQuery({
    queryKey: queryKeys.myCourses("profiles"),
    queryFn: () => api.get("/api/courses/my"),
    enabled: !!user,
  });

  return { ...query, courses: query.data?.courses || [] };
}

// Student course list, fetched fresh so removed students lose access immediately.
export function useStudentCourses() {
  const { user } = useCurrentUser();

  const query = useQuery({
    queryKey: queryKeys.studentCourses,
    queryFn: () => api.get("/api/student/courses"),
    enabled: !!user,
  });

  return {
    ...query,
    courses: (query.data?.courses || []).map((course) => {
      const normalized = {
        id: course._id || course.id,
        name: course.name || course.courseName || "Unknown Course",
        nickname: course.nickname || "",
        academicPeriod: course.academicPeriod || "",
        academicPeriodName: course.academicPeriodName || "",
      };
      return { ...normalized, label: courseLabel(normalized) };
    }),
  };
}

export function useJoinCourseByCode(options) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (enrollmentCode) =>
      api.post("/api/courses/join-by-code", { enrollmentCode }),
    ...options,
    onSuccess: (...args) => {
      queryClient.invalidateQueries({ queryKey: ["my-courses"] });
      queryClient.invalidateQueries({ queryKey: queryKeys.studentCourses });
      options?.onSuccess?.(...args);
    },
  });
}

// Whether the selected course is archived — read-only for its owner, and
// invisible to everyone else. Reads the course document the page has already
// cached, so it costs no extra request. The server refuses the writes either
// way; this is only so the UI stops offering them.
export function useIsArchivedCourse() {
  const courseId = useSelectedCourseId();
  const { course, isPending } = useCourse(courseId);

  return {
    courseId,
    course,
    isArchived: course?.archived === true,
    isPending: !!courseId && isPending,
  };
}

// Archived courses the current user owns. This is a separate endpoint on
// purpose: /api/courses/my excludes archived courses for everyone, so the owner
// reaches them through the Archived tab in the Manage-courses hub rather than
// through the sidebar switcher.
export function useArchivedCourses() {
  const { user, isStudent } = useCurrentUser();

  const query = useQuery({
    queryKey: queryKeys.archivedCourses,
    queryFn: () => api.get("/api/courses/archived"),
    // Students never own a course, so never ask on their behalf.
    enabled: !!user && !isStudent,
  });

  return {
    ...query,
    courses: (query.data?.courses || []).map((course) => ({
      ...course,
      id: course._id || course.id,
      name: course.courseName || "Unknown Course",
    })),
  };
}

// Invalidate everything that changes shape when a course is archived or
// restored: both course lists, the archived list, and the cached course
// document that drives the read-only banner.
function useCourseArchivalInvalidation() {
  const queryClient = useQueryClient();
  return (courseId) => {
    queryClient.invalidateQueries({ queryKey: ["my-courses"] });
    queryClient.invalidateQueries({ queryKey: queryKeys.studentCourses });
    queryClient.invalidateQueries({ queryKey: queryKeys.archivedCourses });
    if (courseId) {
      queryClient.invalidateQueries({ queryKey: queryKeys.course(courseId) });
    }
  };
}

export function useArchiveCourse(options) {
  const invalidate = useCourseArchivalInvalidation();
  return useMutation({
    mutationFn: (courseId) => api.post(`/api/courses/${courseId}/archive`, {}),
    ...options,
    onSuccess: (data, courseId, ...rest) => {
      invalidate(courseId);
      options?.onSuccess?.(data, courseId, ...rest);
    },
  });
}

// Archiving released the course code, so a restore can come back 409
// `code_conflict` when another shell has taken it. Callers read
// `error.body.suggestedCode` and re-submit with an explicit courseCode.
export function useUnarchiveCourse(options) {
  const invalidate = useCourseArchivalInvalidation();
  return useMutation({
    mutationFn: ({ courseId, courseCode }) =>
      api.post(
        `/api/courses/${courseId}/unarchive`,
        courseCode ? { courseCode } : {}
      ),
    ...options,
    onSuccess: (data, variables, ...rest) => {
      invalidate(variables?.courseId);
      options?.onSuccess?.(data, variables, ...rest);
    },
  });
}

// Invalidate every list that renders a course label or a course order: the
// staff switcher, the hub's full profiles, and the student switcher.
function useCourseListInvalidation() {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: ["my-courses"] });
    queryClient.invalidateQueries({ queryKey: queryKeys.studentCourses });
  };
}

// Set or clear a course's nickname. Owner-only on the server; the UI only
// offers the control to owners.
export function useSetCourseNickname(options) {
  const invalidate = useCourseListInvalidation();
  return useMutation({
    mutationFn: ({ courseId, nickname }) =>
      api.patch(`/api/courses/${courseId}/nickname`, { nickname }),
    ...options,
    onSuccess: (...args) => {
      invalidate();
      options?.onSuccess?.(...args);
    },
  });
}

// Save the caller's own switcher order. Takes the full ordered list of course
// ids rather than a move delta, matching the server: absolute positions are
// idempotent, so an impatient double-click cannot scramble the order.
export function useReorderCourses(options) {
  const invalidate = useCourseListInvalidation();
  return useMutation({
    mutationFn: (courseIds) => api.put("/api/courses/order", { courseIds }),
    ...options,
    onSuccess: (...args) => {
      invalidate();
      options?.onSuccess?.(...args);
    },
  });
}

export function useCreateCourse(options) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload) => api.post("/api/courses/new", payload),
    ...options,
    onSuccess: (...args) => {
      queryClient.invalidateQueries({ queryKey: ["my-courses"] });
      options?.onSuccess?.(...args);
    },
  });
}
