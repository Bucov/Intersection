import { useId } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipContentProps } from "recharts";
import { formatClock } from "@/lib/format";

export interface ChartSeries {
  key: string;
  label: string;
  /** A chart token, e.g. var(--chart-ns). Marks only; text stays in text tokens. */
  color: string;
}

interface TimeSeriesChartProps<T extends { t: number }> {
  title: string;
  description?: string;
  data: T[];
  series: ChartSeries[];
  format: (value: number) => string;
  /** Shown when there is nothing to plot yet. */
  empty?: string;
  height?: number;
}

function ticksFor(min: number, max: number): number[] {
  const span = Math.max(1, max - min);
  const step = span <= 90_000 ? 15_000 : span <= 240_000 ? 30_000 : span <= 600_000 ? 60_000 : 120_000;
  const ticks: number[] = [];
  for (let t = Math.ceil(min / step) * step; t <= max; t += step) ticks.push(t);
  return ticks;
}

function LineKey({ color }: { color: string }) {
  return <span className="inline-block h-0.5 w-3 shrink-0 rounded-full" style={{ background: color }} aria-hidden="true" />;
}

/**
 * Line chart over simulation time: 2px lines, hairline grid, one y-axis,
 * a crosshair tooltip that lists every series (values first), a legend that
 * carries the latest values, and a table view for every value.
 */
export function TimeSeriesChart<T extends { t: number }>({ title, description, data, series, format, empty = "No samples yet.", height = 140 }: TimeSeriesChartProps<T>) {
  const id = useId();
  const latest = data[data.length - 1] as Record<string, number | null> | undefined;
  const first = data[0]?.t ?? 0;
  const last = data[data.length - 1]?.t ?? 0;
  const tableRows = data.slice(-12).reverse();

  const renderTooltip = ({ active, payload, label }: TooltipContentProps) => {
    if (!active || !payload?.length) return null;
    return (
      <div className="rounded-md border bg-popover px-2.5 py-2 text-xs shadow-md">
        <p className="mb-1 font-mono tabular text-subtle-foreground">{formatClock(Number(label))}</p>
        <ul className="flex flex-col gap-0.5">
          {series.map(s => {
            const row = payload[0]?.payload as Record<string, number | null> | undefined;
            const value = row?.[s.key];
            return (
              <li key={s.key} className="flex items-center gap-2">
                <LineKey color={s.color} />
                <span className="font-mono tabular font-medium text-foreground">{value === null || value === undefined ? "—" : format(value)}</span>
                <span className="text-muted-foreground">{s.label}</span>
              </li>
            );
          })}
        </ul>
      </div>
    );
  };

  return (
    <figure className="flex flex-col gap-2" aria-labelledby={`${id}-title`}>
      <figcaption className="flex flex-col gap-1">
        <span id={`${id}-title`} className="text-[0.8125rem] font-medium">{title}</span>
        {description ? <span className="text-xs leading-snug text-subtle-foreground">{description}</span> : null}
        {series.length > 1 || latest ? (
          <span className="flex flex-wrap gap-x-4 gap-y-1 text-xs" aria-label="Legend and latest values">
            {series.map(s => (
              <span key={s.key} className="inline-flex items-center gap-1.5">
                <LineKey color={s.color} />
                <span className="text-muted-foreground">{s.label}</span>
                {latest ? <span className="font-mono tabular text-foreground">{latest[s.key] === null || latest[s.key] === undefined ? "—" : format(latest[s.key] as number)}</span> : null}
              </span>
            ))}
          </span>
        ) : null}
      </figcaption>
      {data.length < 2 ? (
        <p className="flex items-center justify-center rounded-md border border-dashed text-xs text-subtle-foreground" style={{ height }}>{empty}</p>
      ) : (
        <div style={{ height }} aria-hidden="true">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
              <XAxis
                dataKey="t"
                type="number"
                domain={[first, last]}
                ticks={ticksFor(first, last)}
                tickFormatter={value => formatClock(Number(value))}
                tick={{ fill: "var(--subtle-foreground)", fontSize: 10, fontFamily: "var(--font-mono)" }}
                tickLine={false}
                axisLine={{ stroke: "var(--chart-grid)" }}
                height={20}
              />
              <YAxis
                width={38}
                tickFormatter={value => format(Number(value))}
                tick={{ fill: "var(--subtle-foreground)", fontSize: 10, fontFamily: "var(--font-mono)" }}
                tickLine={false}
                axisLine={false}
                allowDecimals={false}
                tickCount={4}
              />
              <Tooltip content={renderTooltip} cursor={{ stroke: "var(--muted-foreground)", strokeWidth: 1 }} isAnimationActive={false} />
              {series.map(s => (
                <Line
                  key={s.key}
                  type="linear"
                  dataKey={s.key}
                  name={s.label}
                  stroke={s.color}
                  strokeWidth={2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  dot={false}
                  activeDot={{ r: 4, fill: s.color, stroke: "var(--card)", strokeWidth: 2 }}
                  isAnimationActive={false}
                  connectNulls={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
      {data.length ? (
        <details className="text-xs text-muted-foreground">
          <summary className="w-fit cursor-pointer rounded-sm text-subtle-foreground hover:text-foreground">Data table</summary>
          <table className="mt-2 w-full border-collapse font-mono tabular">
            <thead>
              <tr className="text-left text-subtle-foreground">
                <th className="py-1 pr-3 font-normal">Time</th>
                {series.map(s => <th key={s.key} className="py-1 pr-3 text-right font-normal">{s.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {tableRows.map(row => (
                <tr key={row.t} className="border-t">
                  <td className="py-1 pr-3">{formatClock(row.t)}</td>
                  {series.map(s => {
                    const value = (row as Record<string, number | null>)[s.key];
                    return <td key={s.key} className="py-1 pr-3 text-right text-foreground">{value === null || value === undefined ? "—" : format(value)}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          {data.length > tableRows.length ? <p className="mt-1 text-subtle-foreground">Latest {tableRows.length} of {data.length} samples.</p> : null}
        </details>
      ) : null}
    </figure>
  );
}
