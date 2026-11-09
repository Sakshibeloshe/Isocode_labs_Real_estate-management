import Link from "next/link";
import { db } from "@/lib/server/db";

export const dynamic = "force-dynamic";

export default async function Home() {
  const projects = await db.project.findMany({
    orderBy: { id: "asc" },
    include: { facts: { where: { published: true, key: { in: ["possession", "price_range"] } } } },
  });

  return (
    <div className="mx-auto flex min-h-dvh max-w-6xl flex-col px-5 sm:px-8">
      <header className="flex items-center justify-between py-6">
        <span className="text-[17px] font-semibold tracking-tight">Company A</span>
        <Link href="/login" className="text-sm text-ink-3 hover:text-ink">
          Staff sign in
        </Link>
      </header>

      <main className="flex flex-1 flex-col justify-center py-12">
        <h1 className="wide max-w-3xl text-[40px] font-semibold leading-[1.02] sm:text-[64px]">Homes in Ahmedabad, 2 and 3 BHK.</h1>
        <p className="mt-6 max-w-xl text-lg text-ink-2">
          Ask anything about either project, or book a site visit for a time that suits you. Replies in seconds, in English, हिन्दी or ગુજરાતી.
        </p>

        <div className="mt-14 grid gap-px overflow-hidden rounded-[20px] border border-line bg-line sm:grid-cols-2">
          {projects.map((p) => {
            const possession = p.facts.find((f) => f.key === "possession")?.valueEn.replace(/^.*:\s*/, "").replace(/\.$/, "");
            const price = p.facts.find((f) => f.key === "price_range")?.valueEn.match(/₹[\d.]+ \w+ to ₹[\d.]+ \w+/)?.[0];
            return (
              <Link key={p.id} href={`/chat?project=${p.id}`} className="group flex flex-col bg-surface p-6 transition-colors hover:bg-paper sm:p-8">
                <h2 className="wide text-3xl font-semibold">{p.name}</h2>
                <p className="mt-1 text-ink-2">{p.locality}</p>
                <dl className="mt-8 grid grid-cols-2 gap-y-4 text-[15px]">
                  <dt className="text-ink-3">Homes</dt>
                  <dd>{p.bhkOptions.join(" and ")}</dd>
                  {possession && (
                    <>
                      <dt className="text-ink-3">Possession</dt>
                      <dd>{possession}</dd>
                    </>
                  )}
                  {price && (
                    <>
                      <dt className="text-ink-3">Indicative price</dt>
                      <dd>{price.replace(" to ", " – ")}</dd>
                    </>
                  )}
                </dl>
                <span className="mt-10 font-medium text-indigo group-hover:underline group-hover:underline-offset-4">Ask or book a visit</span>
                <span className="mt-6 border-t border-line-2 pt-3 text-[13px] text-ink-3">Gujarat RERA {p.reraNumber}</span>
              </Link>
            );
          })}
        </div>
      </main>

      <footer className="py-8 text-[13px] leading-relaxed text-ink-3">
        Prices are indicative; the final price is confirmed by our sales team. Project details are as registered with Gujarat RERA. This is a demo with sample data.
      </footer>
    </div>
  );
}
