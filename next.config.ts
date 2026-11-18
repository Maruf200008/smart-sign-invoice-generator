import type { NextConfig } from "next";

const securityHeaders = [
  // Conservative CSP: blocks framing (clickjacking), plugins, <base> hijacking and off-site form posts
  // without restricting the inline scripts Next.js needs.
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  webpack(config, { isServer }) {
    if (!isServer) {
      // harfbuzzjs (PDF text shaping) has a Node-only branch that imports the "module" builtin; it never runs in
      // the browser, so give the client bundle an empty stand-in.
      config.resolve.fallback = { ...config.resolve.fallback, module: false };
      // Its top-level await compiles to async functions, which every browser Next.js supports.
      config.output.environment = { ...config.output.environment, asyncFunction: true };
    }
    return config;
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // Share links are bearer secrets: never send them to third parties via the Referer header.
      { source: "/share/:token*", headers: [{ key: "Referrer-Policy", value: "no-referrer" }, { key: "X-Robots-Tag", value: "noindex, nofollow" }] },
      { source: "/fonts/:file*", headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }] }
    ];
  }
};

export default nextConfig;
