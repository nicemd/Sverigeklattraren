import path from "node:path";
import { loadEnvConfig } from "@next/env";
import type { NextConfig } from "next";

// Local utveckling körs från web/, medan den delade och Git-ignorerade
// hemlighetsfilen avsiktligt ligger i repots rot för både app och deployskript.
loadEnvConfig(path.resolve(process.cwd(), ".."));

const nextConfig: NextConfig = {
  output: "standalone",
};

export default nextConfig;
