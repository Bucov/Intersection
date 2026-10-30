import { Link } from "react-router";
import { PageLayout } from "@/components/common/PageLayout";
import { buttonVariants } from "@/components/ui/button";

export function NotFoundPage() {
  return (
    <PageLayout title="This page does not exist" lead="The address may be mistyped, or the page was moved.">
      <div>
        <Link to="/" className={buttonVariants({ variant: "secondary" })}>Back to the intersection</Link>
      </div>
    </PageLayout>
  );
}
