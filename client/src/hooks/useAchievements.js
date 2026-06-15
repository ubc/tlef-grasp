import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { queryKeys } from "../lib/queryKeys";

// The current user's achievements, optionally scoped to a course.
export function useMyAchievements(courseId, { enabled = true } = {}) {
  const query = useQuery({
    queryKey: queryKeys.achievements(courseId),
    queryFn: () =>
      api.get(`/api/achievement/my${courseId ? `?courseId=${courseId}` : ""}`),
    enabled,
  });

  // Stable reference so callers can use it as a dependency
  const achievements = useMemo(() => query.data?.data || [], [query.data]);

  return { ...query, achievements };
}
