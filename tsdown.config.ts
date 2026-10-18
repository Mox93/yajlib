import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true, // TS 7 is auto-detected and its native declaration emitter is used
  target: "es2020",
  clean: true,
});
