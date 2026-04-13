import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  server: {
    host: "0.0.0.0",
    port: 5173,
    https: resolveHttps(),
  },
  plugins: [vue()],
  preview: {
    host: "0.0.0.0",
    port: 4173,
    https: resolveHttps(),
  },
});

function resolveHttps() {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  const certDir = resolve(currentDir, "../server/certs");
  const keyPath = resolve(certDir, "localhost-key.pem");
  const certPath = resolve(certDir, "localhost-cert.pem");

  if (!existsSync(keyPath) || !existsSync(certPath)) {
    return undefined;
  }

  return {
    key: readFileSync(keyPath),
    cert: readFileSync(certPath),
  };
}
