import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { queryKeys } from "../lib/queryKeys";

export function useCurrentUser() {
  const query = useQuery({
    queryKey: queryKeys.currentUser,
    queryFn: () => api.get("/api/current-user"),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  const user = query.data?.success ? query.data.user : null;

  return {
    ...query,
    user,
    isFaculty: user?.isFaculty || false,
    isStaff: user?.isStaff || false,
    isStudent: user?.isStudent || false,
    role: user?.role || null,
  };
}
