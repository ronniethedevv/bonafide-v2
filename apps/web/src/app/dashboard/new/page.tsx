import { getSession } from "@/lib/session";
import { WORLD } from "@/lib/world";
import { dbConfigured } from "@/lib/db/pool";
import { SignInGate } from "@/components/signin-gate";
import { RegisterWizard } from "@/components/mm/register-wizard";

export const metadata = { title: "Register an engagement · MM Reputation" };

export default async function NewEngagementPage() {
  const session = await getSession();
  if (session?.kind !== "mm") return <SignInGate need="mm" next="/dashboard/new" current={session} />;
  const clients = Object.entries(WORLD.clients).map(([id, c]) => ({ id, name: c.name }));
  // Saved for real only when this MM's account lives in the database.
  return <RegisterWizard clients={clients} persist={dbConfigured() && Boolean(session.accountId)} />;
}
