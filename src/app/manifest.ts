import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Nahuitech Quotes",
    short_name: "Nahuitech",
    description: "Cotizador Expo de Nahuitech.",
    start_url: "/seller",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#F3F3F3",
    theme_color: "#25252A",
    icons: [
      {
        src: "/brand/nahuitech-pwa-icon.svg",
        sizes: "512x512",
        type: "image/svg+xml",
        purpose: "maskable",
      },
      {
        src: "/brand/NAHUITECH%20LOGO.png",
        sizes: "1080x1920",
        type: "image/png",
        purpose: "any",
      },
    ],
  };
}
