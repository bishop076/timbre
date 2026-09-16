import { cache } from "react";

import { fetchAlbum } from "@/lib/discography";

/**
 * One Deezer read per request, shared by the three things that need it: `layout.tsx`, which
 * decides whether there is an album here at all, `generateMetadata`, which titles the tab, and
 * the page itself. Before this they each called `fetchAlbum` on their own and re-parsed the
 * same body.
 */
export const loadAlbum = cache(fetchAlbum);
