import { PageLayout, PageSection } from "@/components/common/PageLayout";

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
      <PageSection title="Team MAGI" description="Team members will be listed here.">
        <p className="rounded-lg border border-dashed px-4 py-3 text-sm text-subtle-foreground">To be added by the team.</p>
      </PageSection>
      <PageSection title="Technology">
        <dl className="grid gap-x-6 gap-y-3 text-[0.9375rem] sm:grid-cols-[8rem_1fr]">
          {STACK.map(row => (
            <div key={row.area} className="contents">
              <dt className="text-muted-foreground">{row.area}</dt>
              <dd>{row.items}</dd>
            </div>
          ))}
        </dl>
      </PageSection>
      <PageSection title="Methodology" description="How the simulation, the scenarios and the comparison are evaluated will be documented here.">
        <p className="rounded-lg border border-dashed px-4 py-3 text-sm text-subtle-foreground">To be added by the team.</p>
      </PageSection>
    </PageLayout>
  );
}
