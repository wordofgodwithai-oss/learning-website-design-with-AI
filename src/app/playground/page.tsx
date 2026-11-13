import { AppShell } from "@/components/AppShell";
import { Playground } from "@/components/Playground";
import { requireSession } from "@/lib/auth";
import { getBalance } from "@/lib/billing";

export const dynamic = "force-dynamic";

export default async function PlaygroundPage() {
  const { user, token } = await requireSession("/playground");
  const balance = await getBalance(user.id);

  return (
    <AppShell user={user} credits={balance.credits}>
      <Playground accessToken={token} credits={balance.credits} email={user.email} />
    </AppShell>
  );
}
