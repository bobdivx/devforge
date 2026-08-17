<?php

namespace App\Services\DevForge\Application;

use App\Models\Application;
use App\Models\Team;
use App\Services\DevForge\Agent\AgentDirectives;
use Illuminate\Validation\ValidationException;

class ApplicationRuntimeSettingsDetector
{
    public function __construct(
        private readonly ApplicationSourceService $sourceService,
        private readonly NixpacksNodeVersionResolver $nodeVersionResolver,
    ) {}

    /**
     * Suggest runtime settings from repo config files (read-only — does not persist).
     *
     * @return array{
     *     available: bool,
     *     reason: string|null,
     *     sources: list<string>,
     *     suggestions: array<string, mixed>,
     *     reasons: list<string>
     * }
     */
    public function detect(Team $team, Application $application): array
    {
        $info = $this->sourceService->info($application);
        if (! ($info['available'] ?? false)) {
            return [
                'available' => false,
                'reason' => is_string($info['reason'] ?? null) ? $info['reason'] : 'Source GitHub indisponible.',
                'sources' => [],
                'suggestions' => [],
                'reasons' => [],
            ];
        }

        $base = ApplicationGitRepositoryParser::normalizeSourcePath($application->base_directory ?: '');
        $files = $this->readConfigFiles($team, $application, $base);

        return $this->inferFromContents($files, $application);
    }

    /**
     * Pure inference from file contents (unit-testable without GitHub).
     *
     * @param  array<string, string>  $files  relative path => content
     * @return array{
     *     available: bool,
     *     reason: string|null,
     *     sources: list<string>,
     *     suggestions: array<string, mixed>,
     *     reasons: list<string>
     * }
     */
    public function inferFromContents(array $files, ?Application $application = null): array
    {
        $sources = array_keys($files);
        $reasons = [];
        $suggestions = [];

        $package = $this->decodeJson($files['package.json'] ?? null);
        $astroConfig = $files['astro.config.mjs']
            ?? $files['astro.config.ts']
            ?? $files['astro.config.js']
            ?? $files['astro.config.mts']
            ?? null;
        $nixpacks = $files['nixpacks.toml'] ?? null;
        $dockerfile = $files['Dockerfile'] ?? $files['dockerfile'] ?? null;
        $envExample = $files['.env.example'] ?? $files['.env'] ?? null;

        $deps = $this->dependencyNames($package);
        $scripts = is_array($package['scripts'] ?? null) ? $package['scripts'] : [];

        $buildScript = isset($scripts['build']) && is_string($scripts['build']) ? $scripts['build'] : null;
        $startScript = isset($scripts['start']) && is_string($scripts['start']) ? $scripts['start'] : null;

        $hasAstroDep = isset($deps['astro']);
        $hasAstroBuildScript = is_string($buildScript) && preg_match('/\bastro\s+build\b/', $buildScript) === 1;
        $hasAstro = $hasAstroDep || is_string($astroConfig) || $hasAstroBuildScript;

        $hasNodeAdapterDep = $this->hasAnyDep($deps, ['@astrojs/node']);
        $hasServerlessAstroAdapter = $this->hasAnyDep($deps, [
            '@astrojs/vercel',
            '@astrojs/cloudflare',
            '@astrojs/netlify',
        ]);
        $astroConfigUsesNodeAdapter = is_string($astroConfig) && (
            str_contains($astroConfig, '@astrojs/node')
            || preg_match('/\badapter\s*:\s*node\s*\(/', $astroConfig) === 1
        );
        $astroHasServerEntryScript = $this->scriptLooksLikeAstroServerEntry($startScript)
            || $this->scriptLooksLikeAstroServerEntry(isset($scripts['preview']) && is_string($scripts['preview']) ? $scripts['preview'] : null);

        $hasNext = isset($deps['next']);
        $hasNuxt = isset($deps['nuxt']);
        $hasVite = isset($deps['vite']) && ! $hasAstro && ! $hasNext;
        $hasExpressOrFastify = $this->hasAnyDep($deps, ['express', 'fastify', 'hono', 'koa', '@nestjs/core']);

        $astroOutputStatic = is_string($astroConfig)
            && preg_match('/\boutput\s*:\s*[\'"]static[\'"]/', $astroConfig) === 1;
        $astroOutputServer = is_string($astroConfig)
            && preg_match('/\boutput\s*:\s*[\'"](server|hybrid)[\'"]/', $astroConfig) === 1;

        $isStatic = false;
        $publishDirectory = '/';
        $portsExposes = '3000';
        $startCommand = null;
        $buildCommand = null;
        $installCommand = null;
        $healthCheckEnabled = true;
        $healthCheckPath = '/';
        $framework = 'unknown';
        $frameworkLabel = 'Inconnu';

        if ($hasAstro) {
            // Node/server signals always win. Static only when explicitly static, or Astro
            // with no adapter / output server / entry.mjs (classic static site).
            $astroSsrSignals = $astroOutputServer
                || $hasNodeAdapterDep
                || $astroConfigUsesNodeAdapter
                || $astroHasServerEntryScript
                || $hasServerlessAstroAdapter;
            $treatAsStatic = ! $astroSsrSignals && ($astroOutputStatic || ! $astroOutputServer);

            if ($treatAsStatic) {
                $isStatic = true;
                $portsExposes = '80';
                $publishDirectory = '/dist';
                $framework = 'astro-static';
                $frameworkLabel = 'Astro static';
                $reasons[] = 'Astro static détecté → nginx + publish_directory=/dist.';
            } else {
                $isStatic = false;
                $portsExposes = '4321';
                $publishDirectory = '/dist';
                $framework = 'astro-ssr';
                $frameworkLabel = 'Astro SSR';
                $reasons[] = 'Astro SSR détecté (adapter Node / output server|hybrid / entry.mjs) → Nixpacks Node, port 4321, pas de site statique nginx.';
                if ($this->scriptLooksLikeAstroServerEntry($startScript)) {
                    $startCommand = $startScript;
                } else {
                    $startCommand = 'node ./dist/server/entry.mjs';
                }
            }

            $buildCommand = ($hasAstroBuildScript || $hasAstroDep || is_string($astroConfig))
                ? 'astro build'
                : $buildScript;
        } elseif ($hasNext) {
            $isStatic = false;
            $portsExposes = '3000';
            $publishDirectory = '/';
            $framework = 'next';
            $frameworkLabel = 'Next.js';
            $reasons[] = 'Next.js détecté → runtime Node (pas static).';
            if (isset($scripts['start']) && is_string($scripts['start'])) {
                $startCommand = $scripts['start'];
            }
            if (isset($scripts['build']) && is_string($scripts['build'])) {
                $buildCommand = $scripts['build'];
            }
        } elseif ($hasNuxt) {
            $isStatic = false;
            $portsExposes = '3000';
            $publishDirectory = '/';
            $framework = 'nuxt';
            $frameworkLabel = 'Nuxt';
            $reasons[] = 'Nuxt détecté → runtime Node.';
            if (isset($scripts['start']) && is_string($scripts['start'])) {
                $startCommand = $scripts['start'];
            }
        } elseif ($hasExpressOrFastify) {
            $isStatic = false;
            $portsExposes = '3000';
            $publishDirectory = '/';
            $framework = 'node';
            $frameworkLabel = 'Node';
            $reasons[] = 'Serveur Node (express/fastify/…) détecté.';
            if (isset($scripts['start']) && is_string($scripts['start'])) {
                $startCommand = $scripts['start'];
            }
        } elseif ($hasVite || (isset($scripts['build']) && is_string($scripts['build']) && preg_match('/\bvite\b/', $scripts['build']) === 1)) {
            $isStatic = true;
            $portsExposes = '80';
            $publishDirectory = '/dist';
            $framework = 'vite';
            $frameworkLabel = 'Vite';
            $reasons[] = 'Vite (SPA/static) détecté → nginx + /dist.';
            if (isset($scripts['build']) && is_string($scripts['build'])) {
                $buildCommand = $scripts['build'];
            }
        } elseif ($package !== null) {
            if (isset($scripts['start']) && is_string($scripts['start'])) {
                $isStatic = false;
                $startCommand = $scripts['start'];
                $framework = 'node';
                $frameworkLabel = 'Node';
                $reasons[] = 'Script npm start présent → runtime Node.';
            } elseif (isset($scripts['build']) && is_string($scripts['build'])) {
                $isStatic = true;
                $portsExposes = '80';
                $buildCommand = $scripts['build'];
                $publishDirectory = '/dist';
                $framework = 'static';
                $frameworkLabel = 'Site statique';
                $reasons[] = 'Build sans start → hypothèse site statique.';
            }
        }

        $portFromEnv = $this->extractPort($envExample)
            ?? $this->extractPort($nixpacks)
            ?? $this->extractPort($dockerfile)
            ?? $this->extractPort($astroConfig);

        if ($portFromEnv !== null && ! $isStatic) {
            $portsExposes = (string) $portFromEnv;
            $reasons[] = "Port {$portsExposes} déduit des fichiers de config.";
        }

        if (is_string($dockerfile) && preg_match('/\bEXPOSE\s+(\d+)/i', $dockerfile, $m) === 1 && ! $isStatic) {
            $portsExposes = $m[1];
            $reasons[] = "Port {$portsExposes} déduit du Dockerfile (EXPOSE).";
        }

        if (is_string($nixpacks) && preg_match('/^\s*cmd\s*=\s*[\'"]([^\'"]+)[\'"]/mi', $nixpacks, $m) === 1) {
            $startCommand = $startCommand ?? $m[1];
            $reasons[] = 'start_command déduit de nixpacks.toml.';
        }

        if (isset($scripts['ci']) && is_string($scripts['ci'])) {
            $installCommand = $scripts['ci'];
        } elseif (isset($files['package-lock.json']) || isset($files['npm-shrinkwrap.json'])) {
            $installCommand = 'npm ci';
        } elseif (isset($files['pnpm-lock.yaml'])) {
            $installCommand = 'pnpm install --frozen-lockfile';
        } elseif (isset($files['yarn.lock'])) {
            $installCommand = 'yarn install --frozen-lockfile';
        } elseif ($hasAstro) {
            // Astro defaults (screenshot): npm ci — lockfile is almost always present; partial GitHub reads may omit it.
            $installCommand = 'npm ci';
        } elseif ($package !== null) {
            $installCommand = 'npm install';
        }

        if ($isStatic) {
            $portsExposes = '80';
            $startCommand = null;
        }

        if ($framework === 'unknown' && is_string($dockerfile) && $dockerfile !== '') {
            $framework = 'dockerfile';
            $frameworkLabel = 'Dockerfile';
            $reasons[] = 'Dockerfile détecté.';
        }

        $nodeVersion = $this->nodeVersionResolver->resolveFromSources(
            $package,
            $files['.nvmrc'] ?? null,
            $files['.node-version'] ?? null,
            $nixpacks,
            $framework,
        );
        $reasons[] = "NIXPACKS_NODE_VERSION={$nodeVersion} déduit du dépôt (engines / .nvmrc / stack).";

        $suggestions = [
            'is_static' => $isStatic,
            'ports_exposes' => $portsExposes,
            'publish_directory' => AgentDirectives::normalizePublishDirectory($publishDirectory) ?? '/',
            'base_directory' => $application?->base_directory ?: '/',
            'start_command' => $startCommand,
            'build_command' => $buildCommand,
            'install_command' => $installCommand,
            'health_check_enabled' => $healthCheckEnabled,
            'health_check_path' => $healthCheckPath,
            'health_check_port' => $isStatic ? '80' : $portsExposes,
            'framework' => $framework,
            'framework_label' => $frameworkLabel,
            'nixpacks_node_version' => $nodeVersion,
            'nixpacks_node_constraint' => $this->nodeVersionResolver->enginesConstraint($package),
        ];

        if ($sources === [] && $reasons === []) {
            return [
                'available' => false,
                'reason' => 'Aucun fichier de config reconnu (package.json, Dockerfile, nixpacks.toml…).',
                'sources' => [],
                'suggestions' => [],
                'reasons' => [],
            ];
        }

        return [
            'available' => true,
            'reason' => null,
            'sources' => array_values($sources),
            'suggestions' => $suggestions,
            'reasons' => $reasons,
        ];
    }

    /**
     * @return array<string, string>
     */
    private function readConfigFiles(Team $team, Application $application, string $base): array
    {
        $candidates = [
            'package.json',
            'package-lock.json',
            'pnpm-lock.yaml',
            'yarn.lock',
            'npm-shrinkwrap.json',
            'astro.config.mjs',
            'astro.config.ts',
            'astro.config.js',
            'astro.config.mts',
            'nixpacks.toml',
            '.nvmrc',
            '.node-version',
            'Dockerfile',
            'dockerfile',
            '.env.example',
        ];

        $files = [];
        foreach ($candidates as $name) {
            $path = ApplicationGitRepositoryParser::joinSourcePath($base, $name);
            try {
                $result = $this->sourceService->readFile($team, $application, $path);
                $content = is_string($result['content'] ?? null) ? (string) $result['content'] : '';
                if ($content !== '') {
                    $files[$name] = $content;
                }
            } catch (ValidationException) {
                continue;
            }
        }

        return $files;
    }

    /**
     * @return array<string, mixed>|null
     */
    private function decodeJson(?string $content): ?array
    {
        if ($content === null || trim($content) === '') {
            return null;
        }

        $decoded = json_decode($content, true);

        return is_array($decoded) ? $decoded : null;
    }

    /**
     * @param  array<string, mixed>|null  $package
     * @return array<string, true>
     */
    private function dependencyNames(?array $package): array
    {
        if ($package === null) {
            return [];
        }

        $names = [];
        foreach (['dependencies', 'devDependencies', 'peerDependencies'] as $key) {
            if (! is_array($package[$key] ?? null)) {
                continue;
            }
            foreach (array_keys($package[$key]) as $name) {
                $names[strtolower((string) $name)] = true;
            }
        }

        return $names;
    }

    /**
     * @param  array<string, true>  $deps
     * @param  list<string>  $needles
     */
    private function hasAnyDep(array $deps, array $needles): bool
    {
        foreach ($needles as $needle) {
            if (isset($deps[strtolower($needle)])) {
                return true;
            }
        }

        return false;
    }

    private function extractPort(?string $content): ?int
    {
        if ($content === null || $content === '') {
            return null;
        }

        if (preg_match('/\bPORT\s*=\s*["\']?(\d{2,5})\b/', $content, $m) === 1) {
            return (int) $m[1];
        }

        if (preg_match('/\bport\s*:\s*(\d{2,5})\b/i', $content, $m) === 1) {
            return (int) $m[1];
        }

        return null;
    }

    private function scriptLooksLikeAstroServerEntry(?string $script): bool
    {
        if ($script === null || $script === '') {
            return false;
        }

        return preg_match('/dist\/server\/entry\.(mjs|js)\b/', $script) === 1;
    }
}
