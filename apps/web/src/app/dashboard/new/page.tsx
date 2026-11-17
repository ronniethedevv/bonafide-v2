import { getSession } from "@/lib/session";
import { WORLD } from "@/lib/world";
import { SignInGate } from "@/components/signin-gate";
import { RegisterWizard } from "@/components/mm/register-wizard";

export const metadata = { title: "Register an engagement · MM Reputation" };

export default async function NewEngagementPage() {
  const session = await getSession();
  if (session?.kind !== "mm") return <SignInGate need="mm" next="/dashboard/new" current={session} />;
  const clients = Object.entries(WORLD.clients).map(([id, c]) => ({ id, name: c.name }));
  return <RegisterWizard clients={clients} />;
}
