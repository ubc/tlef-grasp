// Placeholder for the team credits; the backdrop and white card are Landing's,
// so arriving here from its footer reads as the same surface. index.css
// documents why the heading sits on a card and not on the bare gradient.
export default function Team() {
  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-br from-welcome-from to-welcome-to">
      <main className="flex flex-1 flex-col items-center justify-center gap-8 p-5">
        <div className="w-full max-w-4xl">
          <div className="rounded-[20px] bg-white p-6 text-center shadow-[0_20px_40px_rgba(0,0,0,0.1)] sm:p-10">
            <h1 className="text-3xl font-bold tracking-tight text-black/70 sm:text-4xl">
              Meet the team behind GRASP
            </h1>
          </div>
        </div>
      </main>
    </div>
  );
}
