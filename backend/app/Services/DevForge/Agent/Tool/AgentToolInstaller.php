<?php

namespace App\Services\DevForge\Agent\Tool;

/**
 * Installation de paquets CLI sur un serveur géré (porté depuis forge-tool-install.ts).
 */
class AgentToolInstaller
{
    public function __construct(
        private readonly AgentServerExecutor $serverExecutor,
    ) {}

    /**
     * @return array<string, mixed>
     */
    public function install(string $serverUuid, string $pkg, string $manager = 'auto'): array
    {
        $pkg = trim($pkg);
        if ($pkg === '' || ! $this->isSafePackageName($pkg)) {
            return ['error' => 'Nom de paquet invalide ou non sûr.'];
        }

        $manager = $this->resolveManager($pkg, $manager);
        $command = $this->buildInstallCommand($pkg, $manager);

        $result = $this->serverExecutor->execOnServer($serverUuid, $command, 180);

        return [
            ...$result,
            'pkg' => $pkg,
            'manager' => $manager,
            'installed' => ! isset($result['error']),
        ];
    }

    private function resolveManager(string $pkg, string $manager): string
    {
        $manager = strtolower(trim($manager));
        $allowed = ['auto', 'apt', 'apk', 'npm', 'pip'];

        if (! in_array($manager, $allowed, true)) {
            $manager = 'auto';
        }

        if ($manager !== 'auto') {
            return $manager;
        }

        if (preg_match('/^[a-z0-9_\-]+==[0-9]/i', $pkg)) {
            return 'pip';
        }

        if (str_starts_with($pkg, '@') || str_contains($pkg, '/')) {
            return 'npm';
        }

        return 'apt';
    }

    private function buildInstallCommand(string $pkg, string $manager): string
    {
        $quoted = escapeshellarg($pkg);

        return match ($manager) {
            'apk' => "apk add --no-cache {$quoted}",
            'npm' => "npm install -g {$quoted}",
            'pip' => "pip3 install --user {$quoted} 2>/dev/null || pip install --user {$quoted}",
            default => "(command -v apt-get >/dev/null && DEBIAN_FRONTEND=noninteractive apt-get update -qq && apt-get install -y --no-install-recommends {$quoted}) || (command -v apk >/dev/null && apk add --no-cache {$quoted})",
        };
    }

    private function isSafePackageName(string $pkg): bool
    {
        if (mb_strlen($pkg) > 200) {
            return false;
        }

        return (bool) preg_match('/^[A-Za-z0-9._\-@/:=+|]+(?:\s+[A-Za-z0-9._\-@/:=+|]+)*$/', $pkg);
    }
}
