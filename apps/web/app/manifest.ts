import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Timbre — one search across free music",
    short_name: "Timbre",
    description:
      "Search YouTube Music, Deezer and Apple Music from one place. Every track plays from the service it belongs to, and everything you save stays in this browser.",
    start_url: "/",
    display: "standalone",
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
      {
        src: "/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
