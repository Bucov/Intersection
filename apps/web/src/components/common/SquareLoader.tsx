import { cn } from "@/lib/utils";

const TONES = ["text-group-ns", "text-jev", "text-group-ew"] as const;

/** Loading, in the site's own mark: three squares lighting up in turn. */
export function SquareLoader({ label = "Loading", className }: { label?: string; className?: string }) {
  return (
    <span role="status" className={cn("inline-flex items-center gap-[3px]", className)}>
      {TONES.map((tone, i) => (
        <span
          key={tone}
          aria-hidden="true"
          className={cn("size-[7px] bg-current animate-[square-blink_0.9s_ease-in-out_infinite] motion-reduce:animate-none", tone)}
          style={{ animationDelay: `${i * 150}ms` }}
        />
      ))}
      <span className="sr-only">{label}</span>
    </span>
  );
}
