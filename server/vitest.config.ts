import { defineConfig } from "vitest/config";

// The server suite also runs the simulator's tests (scripts/), which import server code.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "../scripts/**/*.test.ts"],
  },
});
