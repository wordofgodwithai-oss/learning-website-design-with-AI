import { AppShell } from "@/components/AppShell";
import { LibraryClient } from "@/components/LibraryClient";
import { createAccessToken, requireSessionUser } from "@/lib/auth";
import { getBalance } from "@/lib/billing";
import { listPlaylists, listVideos } from "@/lib/repo";

export const dynamic = "force-dynamic";

export default async function LibraryPage() {
  const user = await requireSessionUser();
  const [balance, videos, playlists] = await Promise.all([
    getBalance(user.id),
    listVideos(user.id, { limit: 100 }),
    listPlaylists(user.id),
  ]);
  const { token } = createAccessToken(user);

  return (
    <AppShell user={user} credits={balance.credits}>
      <div className="page-head">
        <div>
          <h1 style={{ fontSize: 30 }}>Library</h1>
          <p>Every render, variant and podcast you have generated on this machine.</p>
        </div>
        <span className="badge badge-accent">{videos.length} videos</span>
      </div>
      <LibraryClient
        initialVideos={videos}
        initialPlaylists={playlists}
        accessToken={token}
      />
    </AppShell>
  );
}
