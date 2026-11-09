import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/server/auth";
import LoginForm from "./form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Staff sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  if (await currentUser()) redirect("/staff/leads");
  const { next } = await searchParams;
  return (
    <div className="flex min-h-dvh flex-col px-5 py-6 sm:px-8">
      <Link href="/" className="text-[17px] font-semibold tracking-tight">
        Company A
      </Link>
      <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-12">
        <h1 className="wide text-3xl font-semibold">Sales team</h1>
        <p className="mt-2 text-ink-2">Sign in to see your leads, visits and handoffs.</p>
        <LoginForm next={next ?? ""} />
        {process.env.DEMO_HINTS !== "false" && (
          <div className="mt-10 border-t border-line pt-4 text-sm text-ink-3">
            <p>Demo accounts, password demo1234</p>
            <p className="mt-1">
              Executive: <span className="text-ink-2">priya@companya.test</span>
            </p>
            <p>
              Sales head: <span className="text-ink-2">head@companya.test</span>
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
