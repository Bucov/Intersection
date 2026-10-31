import { SCENARIO_CATALOG } from '@intersection/shared';
import { lazy, Suspense } from 'react';
const ComparisonPanel = lazy(() => import('@/components/comparison/ComparisonPanel').then(m => ({ default: m.ComparisonPanel })));
import { PageLayout } from '@/components/common/PageLayout';
export function ComparisonPage() {
  return <PageLayout compact title="Live traffic comparison">
    <Suspense fallback={<p>Loading comparison…</p>}><ComparisonPanel scenarioId="normal-traffic" seed={42} scenarios={SCENARIO_CATALOG} /></Suspense>
  </PageLayout>;
}
