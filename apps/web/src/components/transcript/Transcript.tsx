import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowDown } from "lucide-react";
import { useServices } from "@/app/services";
import { BoardHeadline } from "@/components/common/Board";
import { ProvenanceBadge } from "@/components/common/ProvenanceBadge";
import { Square } from "@/components/common/Square";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { formatTimestamp } from "@/lib/format";
import { cn } from "@/lib/utils";
import { shallowEqual, useStore } from "@/state/store";
import { PARTICIPANT_LABEL, type Participant, type TranscriptEntry } from "@/state/transcript";

const PARTICIPANTS: readonly Participant[] = ["simulation", "agent-a", "agent-b", "jev", "controller", "safety"];
const DOT: Record<Participant, string> = {
  simulation: "text-subtle-foreground",
  "agent-a": "text-group-ns",
  "agent-b": "text-group-ew",
  jev: "text-jev",
  controller: "text-warning",
  safety: "text-safety",
};
const TONE = { neutral: "", positive: "text-positive", warning: "text-warning", negative: "text-destructive" } as const;
/** How many of the latest events the strip under the headline draws, one square each. */
const STRIP = 48;

/**
 * One event. Entries are immutable, so a row renders once and is reused while
 * newer events arrive around it.
 */
const Entry = memo(function Entry({ entry }: { entry: TranscriptEntry }) {
  return (
    <li className={cn("grid grid-cols-[3.25rem_1fr] gap-x-3 py-3.5 text-[0.8125rem]", entry.previousGeneration && "opacity-60")} data-kind={entry.kind}>
      <span className="pt-[3px] font-mono text-[0.6875rem] tabular text-subtle-foreground">{formatTimestamp(entry.simulationTimeMs)}</span>
      <div className="flex min-w-0 flex-col gap-1.5">
        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <Square className={cn("size-[9px]", DOT[entry.participant])} />
          {PARTICIPANT_LABEL[entry.participant]}
          {entry.provenance === "mock" || entry.provenance === "live" ? <ProvenanceBadge provenance={entry.provenance} /> : null}
          {entry.previousGeneration ? <span className="text-subtle-foreground">before reset</span> : null}
        </span>
        <span className={cn("text-[0.9375rem] font-[600] leading-snug tracking-[-0.01em]", TONE[entry.tone])}>{entry.title}</span>
        <p className="leading-snug text-muted-foreground">{entry.summary}</p>
        {entry.details.length ? (
          <details className="group">
            <summary className="w-fit cursor-pointer text-xs text-subtle-foreground hover:text-foreground">Details</summary>
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 border-l pl-3 text-xs">
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
});

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
  const filtered = useMemo(() => entries.filter(e => visible.includes(e.participant)), [entries, visible]);
  const counts = useMemo(() => {
    const tally = Object.fromEntries(PARTICIPANTS.map(p => [p, 0])) as Record<Participant, number>;
    for (const entry of entries) tally[entry.participant]++;
    return tally;
  }, [entries]);
  const strip = entries.length > STRIP ? entries.slice(-STRIP) : entries;
  const filteredOut = filtered.length !== entries.length;
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
    <div className="relative flex min-h-0 flex-1 flex-col pt-1" data-testid="transcript">
      <div className="flex shrink-0 flex-col gap-5 px-4 pb-5">
        <BoardHeadline context={<span>Every observation, proposal and decision, in order ⋅ newest last</span>}>
          {filteredOut ? `${filtered.length} of ${entries.length} events shown.` : `${entries.length} ${entries.length === 1 ? "event" : "events"} on record.`}
        </BoardHeadline>
        <div className="flex flex-col gap-2">
          <div className="grid w-fit grid-cols-[repeat(24,10px)] gap-[3px]" role="img" aria-label={`The latest ${strip.length} events by participant`}>
            {strip.length ? (
              strip.map(entry => (
                <span
                  key={entry.key}
                  className={cn(
                    "size-[10px] animate-[square-in_0.42s_cubic-bezier(0.16,1,0.3,1)_both] motion-reduce:animate-none",
                    DOT[entry.participant],
                    visible.includes(entry.participant) ? "bg-current" : "border-[1.5px] border-current",
                  )}
                />
              ))
            ) : (
              <span className="size-[10px] bg-(--cell)" />
            )}
          </div>
          <p className="text-xs text-subtle-foreground">The latest {STRIP} events, one square each. Hollow squares are filtered out below.</p>
        </div>
        <ToggleGroup multiple value={visible} onValueChange={value => changeFilter(value as Participant[])} spacing={0} size="sm" aria-label="Show participants" className="-mx-1.5 flex-wrap gap-x-1 gap-y-0.5">
          {PARTICIPANTS.map(p => {
            const on = visible.includes(p);
            return (
              <ToggleGroupItem key={p} value={p} className="h-7 gap-1.5 rounded-none px-1.5 text-[0.8125rem] font-normal text-subtle-foreground hover:bg-transparent hover:text-foreground aria-pressed:bg-transparent aria-pressed:text-foreground">
                <Square className={cn("size-[9px]", DOT[p])} hollow={!on} />
                {PARTICIPANT_LABEL[p]}
                <span className="font-mono text-xs text-foreground">{counts[p]}</span>
              </ToggleGroupItem>
            );
          })}
        </ToggleGroup>
      </div>
      {historyGap ? <p className="mx-4 mb-3 border-l-2 border-warning py-1 pl-3 text-xs text-muted-foreground">Some events were missed while the stream recovered. The transcript may have gaps; the scene and panels show the current checkpoint.</p> : null}
      <ol ref={list} onScroll={onScroll} className="min-h-0 flex-1 divide-y overflow-y-auto border-t px-4" aria-label="Event transcript">
        {filtered.length ? filtered.map(entry => <Entry key={entry.key} entry={entry} />) : <li className="py-6 text-center text-sm text-subtle-foreground">{entries.length ? "No events from the selected participants yet." : "Events appear here as the simulation runs."}</li>}
      </ol>
      {unseen > 0 ? (
        <button type="button" onClick={jump} className="absolute bottom-3 left-1/2 inline-flex -translate-x-1/2 items-center gap-1.5 border bg-popover px-3 py-1.5 text-xs shadow-[0_12px_28px_-18px_rgb(0_0_0/0.9)] hover:bg-muted">
          <ArrowDown className="size-3.5" aria-hidden="true" />
          {unseen} new {unseen === 1 ? "event" : "events"}
        </button>
      ) : null}
    </div>
  );
}
