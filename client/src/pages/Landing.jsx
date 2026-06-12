import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useCurrentUser } from "../hooks/useCurrentUser";
import { useAppStore } from "../stores/appStore";

export default function Landing() {
  const { user, isLoading } = useCurrentUser();
  const selectedCourse = useAppStore((state) => state.selectedCourse);
  const navigate = useNavigate();

  // Already logged in? Mirror the legacy welcome page redirect.
  useEffect(() => {
    if (user) {
      navigate(selectedCourse ? "/dashboard" : "/onboarding", { replace: true });
    }
  }, [user, selectedCourse, navigate]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-[#667eea] to-[#764ba2] p-5">
      <div className="w-full max-w-[600px]">
        <div className="relative overflow-hidden rounded-[20px] bg-white p-10 text-center shadow-[0_20px_40px_rgba(0,0,0,0.1)]">
          <div className="absolute top-0 right-0 left-0 h-1 bg-gradient-to-r from-[#4facfe] to-[#00f2fe]" />
          <h1 className="text-3xl font-bold text-ink">Welcome to GRASP</h1>
          {!isLoading && (
            <a
              href="/auth/ubcshib"
              className="mt-5 inline-block min-w-[140px] rounded-xl bg-gradient-to-br from-[#4facfe] to-[#00f2fe] px-6 py-4 text-center text-xl font-semibold text-white transition-all hover:-translate-y-0.5 hover:shadow-[0_10px_20px_rgba(79,172,254,0.3)] active:translate-y-0"
            >
              Log in with CWL
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
