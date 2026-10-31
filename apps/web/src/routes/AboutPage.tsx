import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { Square } from "@/components/common/Square";
import { PageLayout, PageSection } from "@/components/common/PageLayout";

// TODO: Replace with the GitHub URL of your Mozaik JEV adapter fork.
const JEV_ADAPTER_FORK_URL = "https://github.com/Bucov/mozaik-Jev-adapter";

const STACK: { area: string; items: string }[] = [
  { area: "Interface", items: "React, TypeScript, Vite, Tailwind CSS, shadcn/ui, Motion, Recharts" },
  { area: "3D scene", items: "Three.js with React Three Fiber" },
  { area: "Backend", items: "Fastify with WebSockets, sharing one typed contract with the interface" },
  { area: "AI", items: "Gemini agents running concurrently through Mozaik, arbitration by JEV through TypeSafe" },
];

export function AboutPage() {
  return (
    <PageLayout
      title={<>Intersection <span className="text-muted-foreground">by MAGI</span></>}
      lead="A Jigjoy October 2026 hackathon project by freshmen at the University of Novi Sad, Faculty of Technical Sciences. Intersection proposes using parallel AI reasoning to help optimise intersections under heavy traffic."
    >
      <PageSection
        title="The idea"
        description="The same four-way intersection runs under two controllers. A traditional fixed-time signal follows one schedule. The AI controller lets two Gemini agents watch North/South and East/West at the same time and propose green times; when they disagree, JEV arbitrates, and a deterministic safety layer validates every change before the light switches."
      />
      <PageSection title="Team MAGI">
        <ul className="grid gap-x-10 gap-y-5 sm:grid-cols-2">
          <li>
            <a href="https://bucov.github.io/my-site/" target="_blank" rel="noopener noreferrer" className={CONTACT_CLASS}>
              Luka Bosnjak <MemberSquare index={0} />
            </a>
          </li>
          <li>
            <a href="https://marexmb.github.io/Portfolio/index.html" target="_blank" rel="noopener noreferrer" className={CONTACT_CLASS}>
              Marko Borocki <MemberSquare index={1} />
            </a>
          </li>
          <li><EmailContact name="Damjan Cirovic" email="damjancirovic55@gmail.com" index={2} /></li>
          <li><EmailContact name="Nikola Boric" email="nikolaboric42@gmail.com" index={3} /></li>
        </ul>
      </PageSection>
      <PageSection title="Technology">
        <dl className="grid gap-x-6 gap-y-3 text-[0.9375rem] sm:grid-cols-[8rem_1fr]">
          {STACK.map(row => (
            <div key={row.area} className="contents">
              <dt className="text-muted-foreground">{row.area}</dt>
              <dd>
                {row.items}
                {row.area === "AI" ? (
                  <a href={JEV_ADAPTER_FORK_URL} target="_blank" rel="noopener noreferrer" className="mt-2 block w-fit text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring">
                    JEV adapter for Mozaik · GitHub fork
                  </a>
                ) : null}
              </dd>
            </div>
          ))}
        </dl>
      </PageSection>
      <PageSection title="Methodology" description="Each new simulation uses a seed to generate a sequence of vehicle movements. We evaluate the resulting traffic, completed journeys and controller decisions using the measures below.">
        <div className="flex flex-col gap-7 text-[0.9375rem] leading-relaxed">
          <MetricGroup title="Traffic & queues" items={[
            ["Demand", "Vehicles on the road and vehicles waiting upstream to enter the intersection."],
            ["Queues", "Current queues for North/South and East/West, the time-average queue and the longest queue observed."],
            ["Accrued waiting", "The maximum accrued wait and total waiting time accrued by unfinished trips."],
          ]} />
          <MetricGroup title="Journeys & signal control" items={[
            ["Completed trips", "The number of vehicles that have finished their journeys, with their average wait and average travel time."],
            ["Throughput", "The vehicle flow rate, expressed in vehicles per hour."],
            ["Signals & emergencies", "The number of signal changes and the signal delay experienced by completed emergency trips."],
          ]} />
          <MetricGroup title="AI & arbitration" items={[
            ["Agent requests", "Requests started, mean and maximum latency, and the number of measured attempts. Latency is measured in wall time."],
            ["JEV decisions", "Arbitration decisions gJEV rouped by high, medium and low confidence, with mean and maximum latency and measured attempts."],
            ["Reliability", "Deadline misses and proposals rejected by the safety layer."],
          ]} />
          <p className="text-muted-foreground">Charts track queue time, throughput and average wait for completed trips over the course of a run. Journey averages and emergency delay remain unavailable until relevant trips have completed.</p>
        </div>
      </PageSection>
    </PageLayout>
  );
}

const CONTACT_CLASS = "group inline-flex min-h-11 items-center gap-3 text-lg font-medium tracking-tight underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring";

function EmailContact({ name, email, index }: { name: string; email: string; index: number }) {
  const [status, setStatus] = useState<"idle" | "copied" | "error">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  async function copyEmail() {
    clearTimeout(timer.current);
    try {
      await navigator.clipboard.writeText(email);
      setStatus("copied");
      timer.current = setTimeout(() => setStatus("idle"), 2400);
    } catch {
      setStatus("error");
    }
  }

  return (
    <div className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1">
      <button type="button" onClick={copyEmail} aria-label={`Copy ${name}'s email`} title={`Copy ${email}`} className={`${CONTACT_CLASS} cursor-pointer text-left`}>
        {name} <MemberSquare index={index} />
      </button>
      <span role="status" className="inline-flex items-center gap-2 text-sm text-muted-foreground">
        {status === "copied" ? <>
          Copied
          <span aria-hidden="true" className="inline-flex gap-[3px]">
            {[0, 1, 2].map(i => <Square key={i} className="size-[7px] text-positive animate-[square-in_0.42s_both] motion-reduce:animate-none" style={{ animationDelay: `${i * 70}ms` }} />)}
          </span>
        </> : status === "error" ? <a href={`mailto:${email}`} className="underline underline-offset-4">Copy failed · Email instead</a> : null}
      </span>
    </div>
  );
}

function MemberSquare({ index }: { index: number }) {
  const reduced = useReducedMotion();
  const colors = ["var(--color-group-ns)", "var(--color-jev)", "var(--color-group-ew)", "var(--color-positive)"];
  const sequence = [...colors.slice(index), ...colors.slice(0, index)];
  return (
    <motion.span
      aria-hidden="true"
      className="inline-block size-[7px] shrink-0"
      style={{ backgroundColor: sequence[0] }}
      animate={reduced ? undefined : { backgroundColor: [...sequence, sequence[0]] }}
      transition={{ duration: 9 + index * 2.3, repeat: Infinity, ease: "easeInOut" }}
    />
  );
}

function MetricGroup({ title, items }: { title: string; items: [string, string][] }) {
  return (
    <div className="flex flex-col gap-3">
      <h3 className="font-medium">{title}</h3>
      <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-[8rem_1fr]">
        {items.map(([label, description]) => (
          <div key={label} className="grid gap-1 sm:col-span-2 sm:grid-cols-subgrid">
            <dt className="text-muted-foreground">{label}</dt>
            <dd>{description}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
