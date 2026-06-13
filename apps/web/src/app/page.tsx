import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/users";
import { Onboarding } from "@/components/Onboarding";

/** Onboarding gate. If already a reader, go straight to the paper. */
export default async function Home() {
  const user = await getCurrentUser();
  if (user) redirect("/read");
  return <Onboarding />;
}
