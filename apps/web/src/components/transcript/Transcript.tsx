import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowDown } from "lucide-react";
import { useServices } from "@/app/services";
import { ProvenanceBadge } from "@/components/common/ProvenanceBadge";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { formatTimestamp } from "@/lib/format";
import { cn } from "@/lib/utils";
import { shallowEqual, useStore } from "@/state/store";
import { PARTICIPANT_LABEL, type Participant, type TranscriptEntry } from "@/state/transcript";

const PARTICIPANTS: readonly Participant[] = ["simulation", "agent-a", "agent-b", "jev", "controller", "safety"];
const DOT: Record<Participant, string> = {
  simulation: "bg-subtle-foreground",
  "agent-a": "bg-group-ns",
  "agent-b": "bg-group-ew",
  jev: "bg-jev",
  controller: "bg-warning",
  safety: "bg-safety",
};
const TONE = { neutral: "", positive: "text-positive", warning: "text-warning", negative: "text-destructive" } as const;

function Entry({ entry }: { entry: TranscriptEntry }) {
  return (
    <li className={cn("grid grid-cols-[3.25rem_1fr] gap-x-2.5 py-2.5 text-[0.8125rem]", entry.previousGeneration && "opacity-60")} data-kind={entry.kind}>
      <span className="pt-px font-mono text-[0.6875rem] tabular text-subtle-foreground">{formatTimestamp(entry.simulationTimeMs)}</span>
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className={cn("size-1.5 rounded-full", DOT[entry.participant])} aria-hidden="true" />
            {PARTICIPANT_LABEL[entry.participant]}
          </span>
          <span className={cn("font-medium", TONE[entry.tone])}>{entry.title}</span>
          {entry.provenance === "mock" || entry.provenance === "live" ? <ProvenanceBadge provenance={entry.provenance} /> : null}
          {entry.previousGeneration ? <span className="text-xs text-subtle-foreground">before reset</span> : null}
        </div>
        <p className="leading-snug text-muted-foreground">{entry.summary}</p>
        {entry.details.length ? (
          <details className="group">
            <summary className="w-fit cursor-pointer rounded-sm text-xs text-subtle-foreground hover:text-foreground">Details</summary>
            <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-md bg-muted/50 p-2 text-xs">
              {entry.details.map(d => (
                <div key={d.label} className="contents">
                  <dt className="text-subtle-foreground">{d.label}</dt>
                  <dd className="min-w-0 break-words">{d.value}</dd>
                </div>
              ))}
            </dl>
          </details>
        ) : null}
      </div>
    </li>
  );
}

/**
 * Observable timeline of the coordination. New entries follow the bottom while
 * the reader is there; scrolling up pauses following until they come back.
 */
export function Transcript() {
  const { session } = useServices();
  const { entries, historyGap } = useStore(session.store, s => ({ entries: s.transcript, historyGap: s.historyGap }), shallowEqual);
  const [visible, setVisible] = useState<Participant[]>([...PARTICIPANTS]);
  const list = useRef<HTMLOListElement>(null);
  const following = useRef(true);
  const [unseen, setUnseen] = useState(0);
  const filtered = entries.filter(e => visible.includes(e.participant));
  const lastKey = filtered[filtered.length - 1]?.key;
  const previousKey = useRef<string | undefined>(undefined);

  useLayoutEffect(() => {
    const el = list.current;
    if (!el || lastKey === previousKey.current) return;
    previousKey.current = lastKey;
    if (following.current) el.scrollTop = el.scrollHeight;
    else setUnseen(n => n + 1);
  }, [lastKey]);

  useEffect(() => {
    // Filters change what is listed; jump to the newest entry of the new view.
    const el = list.current;
    if (el) el.scrollTop = el.scrollHeight;
    following.current = true;
  }, [visible]);

  const changeFilter = (value: Participant[]) => {
    setVisible(value);
    setUnseen(0);
  };

  const onScroll = () => {
    const el = list.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 32;
    following.current = atBottom;
    if (atBottom) setUnseen(0);
  };

  const jump = () => {
    const el = list.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    following.current = true;
    setUnseen(0);
  };

  return (
    <div className="relative flex min-h-0 flex-1 flex-col" data-testid="transcript">
      <ToggleGroup multiple value={visible} onValueChange={value => changeFilter(value as Participant[])} spacing={1} size="sm" variant="outline" aria-label="Show participants" className="flex-wrap px-4 pb-3">
        {PARTICIPANTS.map(p => (
          <ToggleGroupItem key={p} value={p} className="h-7 gap-1.5 px-2 text-xs text-subtle-foreground aria-pressed:text-foreground">
            <span className={cn("size-1.5 rounded-full", DOT[p])} aria-hidden="true" />
            {PARTICIPANT_LABEL[p]}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      {historyGap ? <p className="mx-4 mb-2 rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">Some events were missed while the stream recovered. The transcript may have gaps; the scene and panels show the current checkpoint.</p> : null}
      <ol ref={list} onScroll={onScroll} className="min-h-0 flex-1 divide-y overflow-y-auto px-4" aria-label="Event transcript">
        {filtered.length ? filtered.map(entry => <Entry key={entry.key} entry={entry} />) : <li className="py-6 text-center text-sm text-subtle-foreground">{entries.length ? "No events from the selected participants yet." : "Events appear here as the simulation runs."}</li>}
      </ol>
      {unseen > 0 ? (
        <button type="button" onClick={jump} className="absolute bottom-3 left-1/2 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full border bg-popover px-3 py-1.5 text-xs shadow-md hover:bg-muted">
          <ArrowDown className="size-3.5" aria-hidden="true" />
          {unseen} new {unseen === 1 ? "event" : "events"}
        </button>
      ) : null}
    </div>
  );
}
