import { ProfileView } from "./profile-view";

export const metadata = { title: "Your profile — Timbre" };

/**
 * Your profile.
 *
 * A shell around a client view. There is no account to look up and no session
 * to check — the name, the pictures and the playlists behind the stats all live
 * in the reader's browser, so the server has nothing to contribute.
 */
export default function ProfilePage() {
  return <ProfileView />;
}
