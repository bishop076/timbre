import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/schema.ts",
  out: "./migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
  // Migrations are generated and reviewed, never auto-pushed to a database
  // holding real users' third-party tokens.
  strict: true,
  verbose: true,
});
