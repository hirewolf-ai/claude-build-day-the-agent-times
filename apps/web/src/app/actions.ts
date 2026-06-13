"use server";

import { redirect } from "next/navigation";
import { upsertCurrentUser, clearCurrentSession } from "@/lib/users";
import { locationById, parseXProfile } from "@/lib/profile";

/** Onboarding submit → create the reader, then go to the paper. */
export async function startReading(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const location = String(formData.get("location") ?? "").trim();
  if (!name || !locationById(location)) {
    // Invalid input — bounce back to onboarding.
    redirect("/");
  }
  // X is optional; parse whatever they pasted (or null if blank/unparseable).
  const x = parseXProfile(String(formData.get("x") ?? ""));

  await upsertCurrentUser({
    name,
    location,
    xHandle: x?.handle ?? null,
    xUrl: x?.url ?? null,
  });
  redirect("/read");
}

/** Clear session → wipe the row + cookie, back to onboarding. */
export async function clearSession() {
  await clearCurrentSession();
  redirect("/");
}
