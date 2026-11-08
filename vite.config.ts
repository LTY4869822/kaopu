import { defineConfig, loadEnv, normalizePath } from "vite";
import path from "node:path";
import react from "@vitejs/plugin-react";
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "DATA_DIR");
  const dataDir = normalizePath(path.resolve(process.cwd(), env.DATA_DIR || "data"));
  return {
    plugins: [react()],
    // Only the app is an entry point; reference components and exported HTML are documents.
    optimizeDeps: { entries: ["index.html"] },
    server: {
      host: "0.0.0.0",
      proxy: { "/api": "http://127.0.0.1:3001" },
      // FFmpeg 等运行二进制可能正被下载或占用，不应由前端开发服务器监听。
      watch: { ignored: ["**/vendor/**"] },
      // API authentication cannot protect Vite's direct filesystem URLs.
      // Keep Vite 7's default deny list and block the runtime data directory.
      fs: { deny: [".env", ".env.*", "*.{crt,pem}", "**/.git/**", "**/data/**", "**/.local/**", "**/.venv-docling/**", `${dataDir}/**`] },
    },
  };
});
