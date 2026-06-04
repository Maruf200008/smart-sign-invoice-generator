import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Smart Sign Invoice",
    short_name: "Smart Sign",
    description: "Smart Sign invoice generator",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f4f4f4",
    theme_color: "#e01b24",
    icons: [
      {
        src: "/fav_icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any"
      },
      {
        src: "/fav_icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "maskable"
      }
    ]
  };
}
