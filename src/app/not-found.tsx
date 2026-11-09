import Link from "next/link";
export default function NotFound() {
  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6">
      <p className="text-sm text-ink-3">Page not found</p>
      <h1 className="wide mt-2 text-3xl font-semibold">This link doesn&apos;t lead anywhere.</h1>
      <p className="mt-3 text-ink-2">It may have expired, or you may not have access to it.</p>
      <Link href="/" className="mt-6 font-medium text-indigo">Go to the home page</Link>
    </div>
  );
}
