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
    // Same backdrop as Onboarding, the page a new user is redirected to right
    // after signing in, so the two read as one continuous surface. Tokens
    // rather than the inline hex this page used to carry; index.css documents
    // their ratios and why nothing may sit directly on this gradient.
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-welcome-from to-welcome-to p-5">
      <div className="w-full max-w-2xl">
        <div className="rounded-[20px] bg-white p-6 text-center shadow-[0_20px_40px_rgba(0,0,0,0.1)] sm:p-10">
          {/* Both spans stay inside the one <h1> with real whitespace between
              them, so the accessible name is still "Welcome to GRASP" — what
              tests/e2e/landing.spec.js and tests/a11y/shared.a11y.spec.js match on. */}
          <h1 className="text-4xl font-bold tracking-tight text-black/70 sm:text-5xl">
            <span className="block text-base font-semibold tracking-normal sm:text-lg">
              Welcome to
            </span>{" "}
            <span className="block">GRASP</span>
          </h1>
          <p className="mx-auto mt-4 max-w-lg text-base text-muted sm:text-lg">
            A web application that helps UBC instructors turn course materials
            into evidence-based formative assessments.
          </p>
          {/* Plain <a>, never a react-router <Link>: this has to be a full-page
              navigation to the server's SAML/Shibboleth endpoint. Client-side
              navigation here breaks CWL login. Gated on !isLoading so it does
              not flash before we know whether the user is already signed in. */}
          {!isLoading && (
            // welcome-to, not welcome-from: at text-lg/600 this is normal text
            // by WCAG (large needs 18.66px bold or 24px), so it owes 4.5:1 —
            // welcome-from manages only 3.66:1, welcome-to 6.37:1.
            // brightness-90 stands in for the app's usual hover:bg-*-dark
            // because the palette has no darker purple; it darkens to
            // ~7.36:1, so the hover state moves contrast the safe way.
            <a
              href="/auth/ubcshib"
              className="mt-8 inline-block rounded-xl bg-welcome-to px-8 py-4 text-lg font-semibold text-white transition-all hover:-translate-y-0.5 hover:brightness-90 focus:ring-2 focus:ring-welcome-to focus:ring-offset-2 focus:outline-none active:translate-y-0"
            >
              Log in with CWL
            </a>
          )}
        </div>
      </div>
    </main>
  );
}
