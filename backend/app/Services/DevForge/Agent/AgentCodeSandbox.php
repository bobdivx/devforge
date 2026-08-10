<?php

namespace App\Services\DevForge\Agent;

use Illuminate\Support\Facades\Process;
use Illuminate\Support\Str;

/**
 * Exécution de snippets dans un conteneur Docker éphémère (P5.4).
 * Opt-in, jamais sur l’hôte Coolify, jamais de montage docker.sock.
 */
class AgentCodeSandbox
{
    /** @var list<string> */
    public const LANGUAGES = ['php', 'node', 'python'];

    private const MAX_CODE_BYTES = 50_000;

    private const DEFAULT_TIMEOUT = 15;

    private const MAX_TIMEOUT = 60;

    public function enabled(): bool
    {
        return filter_var(config('devforge.agents_code_sandbox_enabled', false), FILTER_VALIDATE_BOOLEAN);
    }

    /**
     * @return array<string, mixed>
     */
    public function execute(string $language, string $code, ?int $timeoutSeconds = null): array
    {
        if (! $this->enabled()) {
            return [
                'error' => 'Sandbox code désactivée (DEVFORGE_AGENTS_CODE_SANDBOX_ENABLED=false). '
                    .'Utilise run_application_tests ou exec_command SSH pour le code applicatif.',
            ];
        }

        $language = strtolower(trim($language));
        if (! in_array($language, self::LANGUAGES, true)) {
            return [
                'error' => 'Langage non supporté. Autorisés: '.implode(', ', self::LANGUAGES),
            ];
        }

        $code = $this->normalizeCode($code);
        if ($code === '') {
            return ['error' => 'Code vide.'];
        }

        if (strlen($code) > self::MAX_CODE_BYTES) {
            return ['error' => 'Code trop volumineux (max '.self::MAX_CODE_BYTES.' octets).'];
        }

        $safety = $this->assertCodeSafe($code);
        if ($safety !== null) {
            return ['error' => $safety];
        }

        $timeout = max(1, min(self::MAX_TIMEOUT, $timeoutSeconds ?? self::DEFAULT_TIMEOUT));
        $workDir = $this->createWorkspace($language, $code);
        if ($workDir === null) {
            return ['error' => 'Impossible de créer le workspace sandbox.'];
        }

        try {
            $command = $this->buildDockerCommand($language, $workDir, $timeout);
            if ($command === []) {
                return ['error' => 'Configuration sandbox invalide.'];
            }

            if (! $this->dockerAvailable()) {
                return [
                    'error' => 'Binaire docker introuvable sur l’hôte DevForge — sandbox indisponible.',
                    'hint' => 'Installe Docker ou désactive les appels execute_code.',
                ];
            }

            $process = Process::timeout($timeout + 5)->run($command);
            $stdout = trim($process->output());
            $stderr = trim($process->errorOutput());
            $exitCode = $process->exitCode() ?? 1;

            return [
                'ok' => $exitCode === 0,
                'language' => $language,
                'exit_code' => $exitCode,
                'stdout' => mb_substr($stdout, 0, 8000),
                'stderr' => mb_substr($stderr, 0, 4000),
                'timeout_seconds' => $timeout,
                'network' => 'none',
                'image' => $this->imageFor($language),
            ];
        } catch (\Throwable $exception) {
            return [
                'error' => mb_substr($exception->getMessage(), 0, 500),
                'language' => $language,
            ];
        } finally {
            $this->cleanupWorkspace($workDir);
        }
    }

    /**
     * Construit la commande docker run (exposé pour tests).
     *
     * @return list<string>
     */
    public function buildDockerCommand(string $language, string $workDir, int $timeout): array
    {
        $language = strtolower(trim($language));
        $image = $this->imageFor($language);
        $script = $this->scriptName($language);
        $inner = $this->innerCommand($language, $script);

        // Pas de -v /var/run/docker.sock, pas de --privileged, network none.
        return [
            'docker', 'run', '--rm',
            '--network=none',
            '--memory='.$this->memoryLimit(),
            '--cpus='.$this->cpuLimit(),
            '--pids-limit=64',
            '--read-only',
            '--tmpfs', '/tmp:rw,noexec,nosuid,size=64m',
            '--user', $this->containerUser(),
            '-v', $workDir.':/workspace:ro',
            '--workdir', '/workspace',
            $image,
            'sh', '-c', 'timeout '.$timeout.'s '.$inner,
        ];
    }

    public function imageFor(string $language): string
    {
        return match (strtolower($language)) {
            'php' => (string) config('devforge.agents_code_sandbox_image_php', 'php:8.4-cli'),
            'node' => (string) config('devforge.agents_code_sandbox_image_node', 'node:22-alpine'),
            'python' => (string) config('devforge.agents_code_sandbox_image_python', 'python:3.12-alpine'),
            default => 'php:8.4-cli',
        };
    }

    public function dockerAvailable(): bool
    {
        try {
            $result = Process::timeout(5)->run(['docker', 'version', '--format', '{{.Server.Version}}']);

            return $result->successful();
        } catch (\Throwable) {
            return false;
        }
    }

    private function normalizeCode(string $code): string
    {
        $code = str_replace("\r\n", "\n", $code);

        return trim($code);
    }

    private function assertCodeSafe(string $code): ?string
    {
        $lower = mb_strtolower($code);
        $blocked = [
            'docker.sock' => 'Accès docker.sock interdit.',
            '/var/run/docker' => 'Accès au socket Docker interdit.',
            'privileged' => 'Mode privileged interdit.',
            'curl ' => 'Réseau désactivé — curl inutile/interdit dans la sandbox.',
            'wget ' => 'Réseau désactivé — wget inutile/interdit dans la sandbox.',
        ];

        foreach ($blocked as $needle => $reason) {
            if (str_contains($lower, $needle)) {
                return $reason;
            }
        }

        return null;
    }

    private function createWorkspace(string $language, string $code): ?string
    {
        $root = rtrim((string) config('devforge.agents_code_sandbox_workdir', sys_get_temp_dir()), DIRECTORY_SEPARATOR);
        $dir = $root.DIRECTORY_SEPARATOR.'devforge-sandbox-'.Str::lower(Str::random(16));

        if (! @mkdir($dir, 0700, true) && ! is_dir($dir)) {
            return null;
        }

        $path = $dir.DIRECTORY_SEPARATOR.$this->scriptName($language);
        if (@file_put_contents($path, $code) === false) {
            $this->cleanupWorkspace($dir);

            return null;
        }

        @chmod($path, 0400);

        return $dir;
    }

    private function cleanupWorkspace(string $dir): void
    {
        if ($dir === '' || ! is_dir($dir)) {
            return;
        }

        foreach (glob($dir.DIRECTORY_SEPARATOR.'*') ?: [] as $file) {
            @unlink($file);
        }
        @rmdir($dir);
    }

    private function scriptName(string $language): string
    {
        return match ($language) {
            'php' => 'script.php',
            'node' => 'script.js',
            'python' => 'script.py',
            default => 'script.txt',
        };
    }

    private function innerCommand(string $language, string $script): string
    {
        return match ($language) {
            'php' => 'php '.escapeshellarg('/workspace/'.$script),
            'node' => 'node '.escapeshellarg('/workspace/'.$script),
            'python' => 'python '.escapeshellarg('/workspace/'.$script),
            default => 'false',
        };
    }

    private function memoryLimit(): string
    {
        return (string) config('devforge.agents_code_sandbox_memory', '256m');
    }

    private function cpuLimit(): string
    {
        return (string) config('devforge.agents_code_sandbox_cpus', '0.5');
    }

    private function containerUser(): string
    {
        return (string) config('devforge.agents_code_sandbox_user', '65534:65534');
    }
}
