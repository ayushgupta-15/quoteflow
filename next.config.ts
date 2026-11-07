import type { NextConfig } from "next";

const config: NextConfig = {
  serverExternalPackages: ["pdfkit", "exceljs", "pg"],
};

export default config;
