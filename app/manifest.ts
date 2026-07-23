import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Tủ sách của Tuấn",
    short_name: "Tủ sách Tuấn",
    description: "Kho sách cá nhân để bạn bè đọc trực tuyến.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f5f0e5",
    theme_color: "#365747",
    lang: "vi",
    orientation: "any",
    categories: ["books", "education"],
    icons: [
      {
        src: "/pwa-icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/pwa-icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
