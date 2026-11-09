"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "@/components/ui";

export default function Nav({ items }: { items: { href: string; label: string; count?: number }[] }) {
  const path = usePathname();
  return (
    <nav className="mx-auto max-w-7xl overflow-x-auto px-4 [scrollbar-width:none] sm:px-6">
      <ul className="flex gap-1">
        {items.map((i) => {
          const active = path === i.href || path.startsWith(i.href + "/");
          return (
            <li key={i.href}>
              <Link
                href={i.href}
                aria-current={active ? "page" : undefined}
                className={cx(
                  "flex items-center gap-2 whitespace-nowrap border-b-2 px-2.5 pb-2.5 pt-3 text-[15px] transition-colors",
                  active ? "border-indigo font-medium text-ink" : "border-transparent text-ink-3 hover:text-ink",
                )}
              >
                {i.label}
                {!!i.count && <span className="num grid h-5 min-w-5 place-items-center rounded-full bg-indigo px-1.5 text-[12px] font-semibold text-white">{i.count}</span>}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
