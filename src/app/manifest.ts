import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Lumberjack · Signal Desk",
    short_name: "Lumberjack",
    description: "Inteligência operacional para compra de ingressos.",
    start_url: "/",
    display: "standalone",
    background_color: "#0e0913",
    theme_color: "#5f1e82",
    icons: [
      {
        src: "/lumberjack-fury-icon.png",
        sizes: "512x512",
        type: "image/png",
      },
    ],
  };
}
