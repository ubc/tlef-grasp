import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useCurrentUser } from "./useCurrentUser";

// Courses the current user can access. Students and staff use different endpoints.
export function useMyCourses() {
  const { user, isStudent } = useCurrentUser();

  const query = useQuery({
    queryKey: ["my-courses", isStudent ? "student" : "staff"],
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
