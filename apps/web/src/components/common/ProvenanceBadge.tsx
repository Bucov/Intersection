import type { Provenance } from "@intersection/shared";
import { Square } from "@/components/common/Square";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const COPY: Record<Provenance, { label: string; hint: string; className: string; hollow: boolean }> = {
  mock: {
    label: "Mock",
    hint: "Produced by a deterministic mock adapter. No model was called.",
    className: "text-muted-foreground",
    hollow: true,
  },
  live: {
    label: "Live",
    hint: "Returned by the live model through the backend.",
    className: "text-foreground",
    hollow: false,
  },
  deterministic: {
    label: "Rule-based",
    hint: "Computed by deterministic controller or safety rules, not by a model.",
    className: "text-safety",
    hollow: false,
  },
  simulation: {
    label: "Simulation",
    hint: "Emitted by the traffic simulation.",
    className: "text-subtle-foreground",
    hollow: false,
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
            className={cn("inline-flex shrink-0 cursor-help items-center gap-1.5 text-xs font-medium leading-none", copy.className, className)}
          />
        }
      >
        <Square className="size-[7px]" hollow={copy.hollow} />
        {copy.label}
      </TooltipTrigger>
      <TooltipContent className="max-w-64">{copy.hint}</TooltipContent>
    </Tooltip>
  );
}
