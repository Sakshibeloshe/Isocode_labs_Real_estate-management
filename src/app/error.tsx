"use client";
export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="mx-auto flex min-h-[60dvh] max-w-md flex-col justify-center px-6">
      <h1 className="wide text-2xl font-semibold">This page didn&apos;t load.</h1>
      <p className="mt-3 text-ink-2">Check your connection and try again. If it keeps happening, tell the sales head.</p>
      <button onClick={reset} className="mt-6 h-11 w-fit rounded-[10px] bg-indigo px-4 font-medium text-white">Try again</button>
    </div>
  );
}
