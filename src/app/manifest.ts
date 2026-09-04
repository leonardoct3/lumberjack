import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Lumberjack · Signal Desk",
    short_name: "Lumberjack",
    description: "Inteligência operacional para compra de ingressos.",
    start_url: "/",
    display: "standalone",
    background_color: "#0b0a0d",
    theme_color: "#0b0a0d",
    icons: [
      {
        src: "/lumberjack-fury-icon.png",
        sizes: "512x512",
        type: "image/png",
      },
    ],
  };
}
