import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Workspace packages ship as TypeScript source with no build step, so Next
  // compiles them itself.
  transpilePackages: ["@timbre/core", "@timbre/db", "@timbre/providers"],

  // Native/Node-only packages must not be bundled: pg loads native bindings,
  // and pg-boss reads SQL files from disk at runtime.
  serverExternalPackages: ["pg", "pg-boss", "nodemailer"],

  // Next's dev-only route indicator sits bottom-left, which is exactly where
  // the player bar's artwork is — it covered the cover of whatever was
  // playing. It never appears in a production build, so this only affects
  // development. Compile and runtime errors are still surfaced.
  devIndicators: false,
};

export default nextConfig;
