import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Workspace packages ship as TypeScript source with no build step, so Next
  // compiles them itself.
  transpilePackages: ["@timbre/core", "@timbre/db", "@timbre/providers"],

  // Native/Node-only packages must not be bundled: pg loads native bindings,
  // and pg-boss reads SQL files from disk at runtime.
  serverExternalPackages: ["pg", "pg-boss", "nodemailer"],
};

export default nextConfig;
