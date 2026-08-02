import { defineConfig, loadEnv } from "vite";
import laravel from "laravel-vite-plugin";
import path from "node:path";
import { fileURLToPath } from "node:url";

const backendRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, backendRoot, "");
    const viteHost = env.VITE_HOST || null;
    const vitePort = Number(env.VITE_PORT || 5173);

    return {
        // Keep Vite root on backend/ so manifest keys match @vite(['resources/js/app.js', ...]).
        // Builds must run with cwd=backend (see scripts/build-laravel-vite.mjs); invoking
        // `vite --config backend/vite.config.js` from the monorepo root fails to resolve entries.
        root: backendRoot,
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
                    "resources/css/app.css",
                    "resources/js/app.js",
                ],
                refresh: [
                    "resources/views/**",
                    "app/Livewire/**",
                ],
            }),
        ],
    };
});
