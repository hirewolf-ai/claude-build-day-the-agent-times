import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/users";
import { locationById, localTimeFor } from "@/lib/profile";
import { ReadView } from "@/components/ReadView";

/** The paper. Requires a session reader; otherwise back to onboarding. */
export default async function ReadPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/");

  const tz = locationById(user.location)?.tz ?? "UTC";
  const { greeting, dateline, clock } = localTimeFor(tz, user.name);

  return (
    <Suspense fallback={<div className="min-h-screen" />}>
      <ReadView greeting={greeting} dateline={dateline} clock={clock} />
    </Suspense>
  );
}
