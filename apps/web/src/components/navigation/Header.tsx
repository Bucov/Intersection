import { Link, NavLink } from "react-router";
import { motion } from "motion/react";
import { useServices } from "@/app/services";
import { cn } from "@/lib/utils";
import { useStore } from "@/state/store";
import { ConnectionStatus } from "./ConnectionStatus";

/** Columns of the five-part header: two links, the wordmark, one link, the data source. */
const LINKS = [
  { to: "/comparison", label: "compare", column: "sm:col-start-1 sm:justify-self-start" },
  { to: "/settings", label: "settings", column: "sm:col-start-2 sm:justify-self-center" },
  { to: "/about", label: "about", column: "sm:col-start-4 sm:justify-self-center" },
] as const;

const EASE_OUT = [0.16, 1, 0.3, 1] as const;

/**
 * Plain words spread across the top of the room, no bar and no rule. The
 * wordmark sits small at the exact centre and is the way home; a square marks
 * the page you are on.
 */
export function Header() {
  const { intro } = useServices();
  const phase = useStore(intro, s => s.phase);
  const revealed = phase === "handoff" || phase === "done";
  const appear = (delay: number) => ({
    initial: false as const,
    animate: { opacity: revealed ? 1 : 0, y: revealed ? 0 : -4 },
    transition: { duration: 0.6, delay: phase === "handoff" ? delay : 0, ease: EASE_OUT },
  });

  return (
    <header className="pointer-events-none fixed inset-x-0 top-0 z-40 h-(--header-height) text-[0.9375rem] sm:text-base">
      <motion.nav aria-label="Primary" className="absolute inset-x-0 bottom-0 h-1/2 px-4 sm:inset-y-0 sm:h-full sm:px-6 xl:px-8" {...appear(0.5)}>
        <ul className="flex h-full items-center justify-center gap-6 sm:grid sm:grid-cols-5 sm:gap-0">
          {LINKS.map(link => (
            <li key={link.to} className={link.column}>
              <NavLink
                to={link.to}
                className={({ isActive }) =>
                  cn(
                    "group pointer-events-auto relative inline-flex h-9 items-center gap-2 font-[450] tracking-[-0.01em] transition-colors",
                    isActive ? "text-foreground" : "text-foreground/72 hover:text-foreground",
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    <span
                      aria-hidden="true"
                      className={cn("size-1.5 bg-foreground transition-opacity duration-200", isActive ? "opacity-100" : "opacity-0 group-hover:opacity-40")}
                    />
                    {link.label}
                  </>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
      </motion.nav>

      <Link
        to="/"
        data-wordmark-slot
        aria-label="Intersection, home"
        className={cn(
          "wordmark pointer-events-auto absolute left-1/2 top-[1.45rem] -translate-x-1/2 -translate-y-1/2 px-1 py-1 text-[1.0625rem] text-foreground sm:top-1/2",
          phase !== "done" && "invisible",
        )}
      >
        intersection
      </Link>

      <motion.div className="pointer-events-auto absolute right-3 top-[1.45rem] -translate-y-1/2 sm:right-4 sm:top-1/2 xl:right-6" {...appear(0.6)}>
        <ConnectionStatus />
      </motion.div>
    </header>
  );
}
