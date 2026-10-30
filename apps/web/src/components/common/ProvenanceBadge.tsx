import type { Provenance } from "@intersection/shared";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const COPY: Record<Provenance, { label: string; hint: string; className: string }> = {
  mock: {
    label: "Mock",
    hint: "Produced by a deterministic mock adapter. No model was called.",
    className: "border-dashed border-foreground/35 text-muted-foreground",
  },
  live: {
    label: "Live",
    hint: "Returned by the live model through the backend.",
    className: "border-foreground/60 text-foreground",
  },
  deterministic: {
    label: "Rule-based",
    hint: "Computed by deterministic controller or safety rules, not by a model.",
    className: "border-safety/45 text-safety",
  },
  simulation: {
    label: "Simulation",
    hint: "Emitted by the traffic simulation.",
    className: "border-border text-subtle-foreground",
  },
};

/** Where a value came from. Always shown next to model output so mock data is never mistaken for live. */
export function ProvenanceBadge({ provenance, className }: { provenance: Provenance; className?: string }) {
  const copy = COPY[provenance];
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            tabIndex={0}
            className={cn("inline-flex h-5 shrink-0 items-center rounded-full border px-2 text-[0.6875rem] font-medium leading-none", copy.className, className)}
          />
        }
      >
        {copy.label}
      </TooltipTrigger>
      <TooltipContent className="max-w-64">{copy.hint}</TooltipContent>
    </Tooltip>
  );
}
