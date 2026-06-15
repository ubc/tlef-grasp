import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { queryKeys } from "../lib/queryKeys";
import { useCurrentUser } from "./useCurrentUser";

// Courses the current user can access, normalized to { id, name }.
// Students and staff use different endpoints.
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
    courses: (query.data?.courses || []).map((course) => ({
      ...course,
      id: course._id || course.id,
      name: course.name || course.courseName || "Unknown Course",
    })),
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
    courses: (query.data?.courses || []).map((course) => ({
      id: course._id || course.id,
      name: course.name || course.courseName || "Unknown Course",
    })),
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
