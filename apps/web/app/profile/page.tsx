import { cookies } from "next/headers";

import { ProfileView } from "./profile-view";

export const metadata = { title: "Your profile — Timbre" };

function readName(raw = ""): string | null {
  try {
    return decodeURIComponent(raw).slice(0, 64) || null;
  } catch {
    return null;
  }
}

export default async function ProfilePage() {
  const jar = await cookies();

  return <ProfileView serverName={readName(jar.get("timbre-name")?.value)} />;
}
