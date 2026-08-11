import type { MetadataRoute } from "next";

/**
 * The web app manifest, which is what makes Timbre installable.
 *
 * A route rather than a static `public/manifest.json` so Next serves it with
 * the right content type and keeps it beside the metadata it belongs with.
 *
 * **`display: "standalone"` is the point of the exercise.** Installed, Timbre
 * loses the browser's address bar and tab strip — which on a phone is roughly
 * 120px of vertical space, on a screen where the player bar and the bottom nav
 * already claim their share.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Timbre — one search across free music",
    short_name: "Timbre",
    description:
      "Search YouTube Music, Deezer and Apple Music from one place. Every track plays from the service it belongs to, and everything you save stays in this browser.",
    start_url: "/",
    display: "standalone",
    /*
     * Dark, and matching the album theme's ground.
     *
     * These two are painted by the operating system before any of Timbre's CSS
     * exists — the splash screen and the window chrome — so they cannot read a
     * custom property. The default ground is the honest choice: a reader on the
     * light theme sees one dark frame at launch rather than every reader seeing
     * a white flash before a dark app.
     */
    background_color: "#0f0f14",
    theme_color: "#0f0f14",
    orientation: "any",
    categories: ["music", "entertainment"],
    icons: [
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      /*
       * A second 512 for `maskable`, not the same file listed twice.
       *
       * Android crops an icon to whatever shape the launcher uses — circle,
       * squircle, teardrop — and only guarantees the middle 80%. An icon drawn
       * to its own edges loses its corners to that crop, so the maskable one is
       * drawn inset with the art safely inside the circle.
       */
      {
        src: "/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
