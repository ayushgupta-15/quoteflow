import type { NextConfig } from "next";

const config: NextConfig = {
  serverExternalPackages: ["pdfkit", "exceljs", "pg"],
  // pdfkit reads its built-in font metrics from disk at runtime; make sure they ship with the route.
  outputFileTracingIncludes: {
    "/quotes/[id]/pdf": ["./node_modules/pdfkit/js/data/**/*"],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default config;
