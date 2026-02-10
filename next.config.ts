import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Turbopack configuration (Next.js 16+ default)
  turbopack: {
    // Native modules are automatically externalized in Turbopack
    // No explicit configuration needed for server-side externals
  },
  // Keep webpack config for compatibility (when using --webpack flag)
  webpack: (config, { isServer }) => {
    if (isServer) {
      // Exclude native modules from webpack bundling for server-side
      // These are modules that should be loaded at runtime, not bundled
      config.externals = config.externals || [];

      // Handle array or function externals
      if (Array.isArray(config.externals)) {
        config.externals.push({
          "pdfjs-dist": "commonjs pdfjs-dist",
          "tesseract.js": "commonjs tesseract.js",
        });
      } else if (typeof config.externals === "function") {
        const originalExternals = config.externals;
        config.externals = [
          originalExternals,
          {
            "pdfjs-dist": "commonjs pdfjs-dist",
            "tesseract.js": "commonjs tesseract.js",
          },
        ];
      } else {
        config.externals = {
          ...config.externals,
          "pdfjs-dist": "commonjs pdfjs-dist",
          "tesseract.js": "commonjs tesseract.js",
        };
      }
    }
    return config;
  },
};

export default nextConfig;
