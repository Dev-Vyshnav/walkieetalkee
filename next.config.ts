import type { NextConfig } from "next";
const withPWA = require("@ducanh2912/next-pwa").default({
  dest: "public",
  cacheOnFrontEndNav: true,
  aggressiveFrontEndNavCaching: true,
  reloadOnOnline: true,
  swMinify: true,
  disable: process.env.NODE_ENV === "development",
  workboxOptions: {
    disableDevLogs: true,
  },
});

const nextConfig: NextConfig = {
  /* config options here */
  // @ts-ignore - Next.js might expect this at top level in some versions
  allowedDevOrigins: ['kcyyaf-ip-49-37-234-137.tunnelmole.net'],
  // @ts-ignore - Turbopack is enabled by default in Next.js 16
  turbopack: {},
};


export default withPWA(nextConfig);

