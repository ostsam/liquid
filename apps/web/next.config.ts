import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@copilotkit/runtime"],
  transpilePackages: ["@xyflow/react"],
};

export default nextConfig;
