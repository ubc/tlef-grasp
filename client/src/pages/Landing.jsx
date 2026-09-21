import { useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useCurrentUser } from "../hooks/useCurrentUser";
import { useAppStore } from "../stores/appStore";

// The instructor workflow in order. Each step reuses its destination's Sidebar
// icon, so the nav vocabulary is already familiar by the first login.
const STEPS = [
  {
    icon: "fa-wand-magic-sparkles",
    blurb:
      "Upload lecture material to generate learning objectives and targeted questions.",
  },
  {
    icon: "fa-pen-to-square",
    blurb: "Review and edit AI-generated questions, then approve what reaches students.",
  },
  {
    icon: "fa-book",
    blurb:
      "Build quizzes from your question bank and release them to sections on a schedule.",
  },
  {
    icon: "fa-chart-bar",
    blurb: "Track scores and resolve the questions students flag for review.",
  },
];

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
    // Shares Onboarding's backdrop — the page users reach straight after signing
    // in — so the two read as one surface. index.css documents these tokens'
    // contrast ratios and why text must not sit directly on the gradient.
    <div className="flex min-h-screen flex-col bg-gradient-to-br from-welcome-from to-welcome-to">
      <main className="flex flex-1 flex-col items-center justify-center gap-8 p-5">
        {/* max-w-2xl matches the steps grid below while both are stacked, so
          their edges line up; keep the two in step if either changes. */}
        <div className="w-full max-w-2xl lg:max-w-4xl">
          <div className="rounded-[20px] bg-white p-6 shadow-[0_20px_40px_rgba(0,0,0,0.1)] sm:p-10">
            {/* Two columns only from lg, the breakpoint where the steps below
              leave their 2x2 grid, so the two blocks change shape together.

              A 2x2 grid rather than two flex columns: heading | button on row 1,
              description | note on row 2. Row 1 sizes to the heading and both
              cells justify-end into it, which lands the button's bottom on
              GRASP's bottom with no hardcoded offset — so it survives changes to
              either one's size. Row 2 then starts on a single line, aligning both
              paragraphs as a side effect. Source order stays heading,
              description, button, note, leaving the stacked order untouched.
              Keep the row gap at 0: it is what joins the two border-l segments
              into one unbroken divider. */}
            <div className="flex flex-col lg:grid lg:grid-cols-2 lg:gap-x-8">
              <div className="flex flex-col justify-end text-center lg:col-start-1 lg:row-start-1 lg:text-left">
                <div
                  className="mx-auto mb-5 h-1 w-12 rounded-full bg-welcome-to lg:mx-0"
                  aria-hidden="true"
                />
                {/* Keep both spans inside this single <h1>, separated by real
                  whitespace: the accessible name has to stay "Welcome to GRASP",
                  which landing.spec.js and shared.a11y.spec.js both match on. */}
                <h1 className="text-5xl font-bold tracking-tight text-black/70 sm:text-6xl">
                  <span className="block text-base font-semibold tracking-normal sm:text-lg">
                    Welcome to
                  </span>{" "}
                  <span className="block text-welcome-to">GRASP</span>
                </h1>
              </div>
              <p className="mt-4 text-center text-base text-muted sm:text-lg lg:col-start-1 lg:row-start-2 lg:text-left">
                A web application that helps UBC instructors turn course materials into
                evidence-based formative assessments.
              </p>
              {/* Plain <a>, never a react-router <Link>: this has to be a full-page
                navigation to the server's SAML/Shibboleth endpoint, and client-side
                routing breaks CWL login. The !isLoading gate keeps it from flashing
                before we know whether the user is already signed in, and the note
                shares that gate rather than describing a button that is not there. */}
              {!isLoading && (
                <>
                  {/* The divider turns rather than disappears: a top border while
                    stacked, a left border once side by side. items-center holds the
                    button at its natural width — as a flex item it would otherwise
                    stretch full-bleed. */}
                  <div className="mt-8 flex flex-col items-center justify-end border-t border-surface-border pt-8 lg:col-start-2 lg:row-start-1 lg:mt-0 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-8">
                    {/* welcome-to, not welcome-from: at text-lg/600 this counts as
                      normal text, so it owes 4.5:1 — welcome-from gives only
                      3.66:1, welcome-to 6.37:1. brightness-90 replaces the app's
                      usual hover:bg-*-dark, the palette having no darker purple;
                      it darkens to ~7.36:1, moving contrast the safe way. */}
                    <a
                      href="/auth/ubcshib"
                      className="inline-block rounded-3xl bg-welcome-to px-8 py-3 text-lg font-semibold text-white transition-all hover:-translate-y-0.5 hover:brightness-90 focus:ring-2 focus:ring-welcome-to focus:ring-offset-2 focus:outline-none active:translate-y-0"
                    >
                      Log in with CWL
                    </a>
                  </div>
                  {/* Padding, not a top margin: a margin would open a gap in the
                    border-l and break the divider in two. */}
                  <p className="mx-auto mt-4 max-w-sm text-center text-sm text-muted lg:col-start-2 lg:row-start-2 lg:mx-0 lg:mt-0 lg:max-w-none lg:border-l lg:border-surface-border lg:pt-4 lg:pl-8">
                    Instructors and TAs sign in with CWL. Students reach their quizzes
                    through the same login.
                  </p>
                </>
              )}
            </div>
          </div>
        </div>
        {/* <ol>, not <ul>: these are ordered steps, and DOM order carries the
          sequence however they reflow. role="list" restores the semantics
          Tailwind's preflight strips when it sets list-style:none — without it
          VoiceOver stops announcing this as a list. */}
        <ol
          role="list"
          className="grid w-full max-w-2xl grid-cols-1 gap-4 sm:grid-cols-2 lg:max-w-6xl lg:grid-cols-4"
        >
          {STEPS.map(({ icon, blurb }) => (
            <li
              key={icon}
              className="rounded-2xl bg-white p-5 text-left shadow-[0_4px_12px_rgba(0,0,0,0.12)]"
            >
              <i className={`fas ${icon} text-xl text-welcome-to`} aria-hidden="true" />
              <p className="mt-3 text-sm text-muted">{blurb}</p>
            </li>
          ))}
        </ol>
      </main>
      {/* White text on the bare gradient is safe only because of where this sits:
          `to bottom right` puts the bottom-left corner at 50% of the gradient
          line, so the footer spans 50%-100% and never reaches the light end.
          Worst case 4.86:1, rising to 6.37:1. Move this block further up the page
          and it drops to 3.66:1 and fails. The link is underlined so it does not
          read as a link by colour alone, and takes an outline rather than a ring
          because ring-offset needs a solid colour behind it and there is none. */}
      <footer className="px-5 pb-6 text-center text-sm text-white">
        <div className="mx-auto max-w-4xl border-t border-white/25 pt-6">
          <p className="mx-auto max-w-2xl">
            Built by the Learning Technology Innovation Centre (LTIC) at the University of
            British Columbia, supported by the Teaching and Learning Enhancement Fund
            (TLEF).{" "}
            <Link
              to="/team"
              className="font-semibold underline underline-offset-2 hover:no-underline focus:outline-2 focus:outline-offset-2 focus:outline-white"
            >
              Team behind GRASP
            </Link>
          </p>
          <p className="mt-2">
            Contact support:{" "}
            <a
              href="mailto:LT.hub@ubc.ca"
              className="font-semibold underline underline-offset-2 hover:no-underline focus:outline-2 focus:outline-offset-2 focus:outline-white"
            >
              LT.hub@ubc.ca
            </a>
          </p>
        </div>
      </footer>
    </div>
  );
}
