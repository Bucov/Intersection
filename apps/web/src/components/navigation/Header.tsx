import { Link, NavLink } from "react-router";
import { motion } from "motion/react";
import { useServices } from "@/app/services";
import { cn } from "@/lib/utils";
import { useStore } from "@/state/store";
import { ConnectionStatus } from "./ConnectionStatus";

const LINKS = [
  { to: "/", label: "Home", end: true },
  { to: "/settings", label: "Settings", end: false },
  { to: "/about", label: "About", end: false },
] as const;

export function Header() {
  const { intro } = useServices();
  const phase = useStore(intro, s => s.phase);
  const revealed = phase === "handoff" || phase === "done";

  return (
    <header className="fixed inset-x-0 top-0 z-40 h-(--header-height) bg-background">
      <div className="grid h-full grid-cols-[1fr_auto_1fr] items-center gap-3 px-3 sm:px-5">
        <motion.nav
          aria-label="Primary"
          className="justify-self-start"
          initial={false}
          animate={{ opacity: revealed ? 1 : 0, y: revealed ? 0 : -4 }}
          transition={{ duration: 0.6, delay: phase === "handoff" ? 0.5 : 0, ease: [0.16, 1, 0.3, 1] }}
        >
          <ul className="flex items-center gap-0.5 sm:gap-1">
            {LINKS.map(link => (
              <li key={link.to}>
                <NavLink
                  to={link.to}
                  end={link.end}
                  className={({ isActive }) =>
                    cn(
                      "relative inline-flex h-8 items-center rounded-md px-2 text-sm transition-colors sm:px-2.5",
                      "after:absolute after:inset-x-2.5 after:-bottom-px after:h-px after:rounded-full after:bg-foreground after:opacity-0 after:transition-opacity",
                      isActive ? "text-foreground after:opacity-100" : "text-muted-foreground hover:bg-muted hover:text-foreground",
                    )
                  }
                >
                  {link.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </motion.nav>

        <Link
          to="/"
          data-wordmark-slot
          aria-label="Intersection, home"
          className={cn("wordmark rounded-sm px-1 text-[1.3125rem] text-foreground", phase !== "done" && "invisible")}
        >
          Intersection
        </Link>

        <motion.div
          className="justify-self-end"
          initial={false}
          animate={{ opacity: revealed ? 1 : 0, y: revealed ? 0 : -4 }}
          transition={{ duration: 0.6, delay: phase === "handoff" ? 0.6 : 0, ease: [0.16, 1, 0.3, 1] }}
        >
          <ConnectionStatus />
        </motion.div>
      </div>
    </header>
  );
}
