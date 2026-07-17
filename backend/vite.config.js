import { defineConfig, loadEnv } from "vite";
import laravel from "laravel-vite-plugin";
import path from "node:path";
import { fileURLToPath } from "node:url";

const backendRoot = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(backendRoot, "..");

function fromRepo(...segments) {
    return path.relative(repoRoot, path.join(...segments)).replaceAll("\\", "/");
}

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, backendRoot, "");
    const viteHost = env.VITE_HOST || null;
    const vitePort = Number(env.VITE_PORT || 5173);

    return {
        root: repoRoot,
        css: {
            postcss: path.join(backendRoot, "postcss.config.cjs"),
        },
        server: {
            watch: {
                ignored: [
                    "**/dev_*_data/**",
                    "**/storage/**",
                ],
            },
            host: "0.0.0.0",
            allowedHosts: true,
            cors: {
                origin: [
                    /^https?:\/\/localhost(:\d+)?$/,
                    /^https?:\/\/127\.0\.0\.1(:\d+)?$/,
                    /^https?:\/\/\[::1\](:\d+)?$/,
                    ...(env.APP_URL ? [env.APP_URL] : []),
                    ...(viteHost ? [`http://${viteHost}:${vitePort}`, `https://${viteHost}:${vitePort}`] : []),
                ],
            },
            origin: viteHost ? `http://${viteHost}:${vitePort}` : undefined,
            hmr: viteHost
                ? { host: viteHost, clientPort: vitePort }
                : true,
        },
        plugins: [
            laravel({
                input: [
                    fromRepo(backendRoot, "resources", "css", "app.css"),
                    fromRepo(backendRoot, "resources", "js", "app.js"),
                ],
                refresh: [
                    fromRepo(backendRoot, "resources", "views") + "/**",
                    fromRepo(backendRoot, "app", "Livewire") + "/**",
                ],
                publicDirectory: fromRepo(backendRoot, "public"),
            }),
        ],
    };
});
