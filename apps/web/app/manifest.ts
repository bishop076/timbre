import type { MetadataRoute } from "next";

/** The manifest that makes Timbre installable — a route, so Next serves it with the right
 * content type. `display: "standalone"` is the point: installed, Timbre loses the address
 * bar and tab strip, roughly 120px of vertical space on a phone. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Timbre — one search across free music",
    short_name: "Timbre",
    description:
      "Search YouTube Music, Deezer and Apple Music from one place. Every track plays from the service it belongs to, and everything you save stays in this browser.",
    start_url: "/",
    display: "standalone",
    // Painted by the OS before any of Timbre's CSS exists, so these cannot read a custom
    // property. Dark by default: one dark frame beats a white flash for everyone else.
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
      // A second 512 for `maskable`, not the same file twice: Android crops to the
      // launcher's shape and only guarantees the middle 80%, so this one is drawn inset.
      {
        src: "/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
