import { AppShell } from "@/components/AppShell";
import { Playground } from "@/components/Playground";
import { createAccessToken, requireSessionUser } from "@/lib/auth";
import { getBalance } from "@/lib/billing/mock-billing";

export const dynamic = "force-dynamic";

export default async function PlaygroundPage() {
  const user = await requireSessionUser();
  const balance = await getBalance(user.id);
  const { token } = createAccessToken(user);

  return (
    <AppShell user={user} credits={balance.credits}>
      <Playground accessToken={token} credits={balance.credits} email={user.email} />
    </AppShell>
  );
}
