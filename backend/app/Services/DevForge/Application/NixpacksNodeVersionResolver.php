<?php

namespace App\Services\DevForge\Application;

/**
 * Choisit une version Node compatible Nixpacks (16/18/20/22/24) à partir
 * du dépôt (engines, .nvmrc, Astro/Nuxt) ou des logs de build.
 *
 * Nixpacks 1.41 résout NIXPACKS_NODE_VERSION=22 en Node 22.11.0, trop ancien
 * pour Astro 7 (>= 22.12) et trop récent pour Nuxt 2 / Apollo Federation (< 17).
 */
class NixpacksNodeVersionResolver
{
    public const DEFAULT = '22';

    /** @var list<string> */
    public const SUPPORTED = ['16', '18', '20', '22', '24'];

    /**
     * Versions réellement fournies par Nixpacks 1.41 pour chaque major.
     *
     * @var array<string, string>
     */
    public const RESOLVED = [
        '16' => '16.20.2',
        '18' => '18.20.8',
        '20' => '20.18.1',
        '22' => '22.11.0',
        '24' => '24.11.0',
    ];

    public const AUTO_COMMENT = 'devforge:auto:nixpacks-node';

    /**
     * @param  array<string, mixed>|null  $package
     */
    public function resolveFromSources(
        ?array $package,
        ?string $nvmrc = null,
        ?string $nodeVersionFile = null,
        ?string $nixpacksToml = null,
        ?string $framework = null,
    ): string {
        $engines = $this->enginesConstraint($package);
        if (is_string($engines) && $engines !== '') {
            $fromEngines = $this->pickMajorForConstraint($engines);
            if ($fromEngines !== null) {
                return $fromEngines;
            }
        }

        $fromFile = $this->majorFromVersionFile($nvmrc)
            ?? $this->majorFromVersionFile($nodeVersionFile);
        $fromFramework = $this->fromFramework($package, $framework);

        if ($fromFile !== null) {
            if ($fromFramework !== null && (int) $fromFramework > (int) $fromFile) {
                return $fromFramework;
            }

            return $fromFile;
        }

        $fromToml = $this->majorFromVersionFile($this->nixpacksTomlVersion($nixpacksToml));
        if ($fromToml !== null) {
            if ($fromFramework !== null && (int) $fromFramework > (int) $fromToml) {
                return $fromFramework;
            }

            return $fromToml;
        }

        return $fromFramework ?? self::DEFAULT;
    }

    /**
     * @param  array<string, mixed>|null  $package
     */
    public function enginesConstraint(?array $package): ?string
    {
        $engines = $package['engines'] ?? null;
        if (! is_array($engines)) {
            return null;
        }

        $node = $engines['node'] ?? null;

        return is_string($node) && trim($node) !== '' ? trim($node) : null;
    }

    public function resolveFromBuildError(string $logs, string $currentMajor): ?string
    {
        $constraint = $this->constraintFromBuildError($logs, $currentMajor);
        if ($constraint === null) {
            return null;
        }

        $next = $this->pickMajorForConstraint($constraint);
        if ($next === null) {
            return null;
        }

        $normalizedCurrent = $this->normalizeMajor($currentMajor) ?? $currentMajor;

        return $next === $normalizedCurrent ? null : $next;
    }

    public function logsLookLikeEngineMismatch(string $logs): bool
    {
        $blob = mb_strtolower($logs);

        return str_contains($blob, 'incompatible with this module')
            || str_contains($blob, 'is not supported by astro')
            || str_contains($blob, 'the engine "node" is incompatible')
            || str_contains($blob, 'engine "node" is incompatible')
            || (str_contains($blob, 'ebadengine') && str_contains($blob, 'did not complete successfully'))
            || (bool) preg_match('/please upgrade node\.js to a supported version/i', $logs);
    }

    public function pickMajorForConstraint(string $constraint): ?string
    {
        foreach (array_reverse(self::SUPPORTED) as $major) {
            if ($this->majorSatisfies($major, $constraint)) {
                return $major;
            }
        }

        return null;
    }

    public function majorSatisfies(string $major, string $constraint): bool
    {
        $normalized = $this->normalizeMajor($major);
        if ($normalized === null) {
            return false;
        }

        $resolved = self::RESOLVED[$normalized] ?? null;
        if ($resolved === null) {
            return false;
        }

        return $this->versionSatisfies($resolved, $constraint);
    }

    public function normalizeMajor(string $raw): ?string
    {
        if (preg_match('/(\d+)/', $raw, $match) !== 1) {
            return null;
        }

        $major = (int) $match[1];
        foreach (self::SUPPORTED as $supported) {
            if ((int) $supported === $major) {
                return $supported;
            }
        }

        foreach (self::SUPPORTED as $supported) {
            if ((int) $supported >= $major) {
                return $supported;
            }
        }

        return self::SUPPORTED[array_key_last(self::SUPPORTED)];
    }

    public function constraintFromBuildError(string $logs, string $currentMajor): ?string
    {
        if (preg_match('/Expected version ["\']([^"\']+)["\']/i', $logs, $match) === 1) {
            return trim($match[1]);
        }

        if (preg_match('/supported version:\s*["\']([^"\']+)["\']/i', $logs, $match) === 1) {
            return $this->unredactConstraint(trim($match[1]), $currentMajor);
        }

        if (preg_match('/Please upgrade Node\.js to a supported version:\s*["\']?([^"\'\s]+)/i', $logs, $match) === 1) {
            return $this->unredactConstraint(trim($match[1]), $currentMajor);
        }

        if (preg_match('/is not supported by Astro/i', $logs)) {
            return '>=22.12.0';
        }

        if (preg_match('/required:\s*\{\s*node:\s*[\'"]([^\'"]+)[\'"]/i', $logs, $match) === 1) {
            return $this->unredactConstraint(trim($match[1]), $currentMajor);
        }

        return null;
    }

    /**
     * @param  array<string, mixed>|null  $package
     */
    private function fromFramework(?array $package, ?string $framework): ?string
    {
        $astroMajor = $this->dependencyMajor($package, 'astro');
        if ($astroMajor !== null && $astroMajor >= 7) {
            return '24';
        }

        if (in_array($framework, ['astro-ssr', 'astro-static'], true) && $astroMajor !== null && $astroMajor >= 7) {
            return '24';
        }

        $nuxtMajor = $this->dependencyMajor($package, 'nuxt');
        if ($nuxtMajor === 2) {
            return '16';
        }

        return null;
    }

    /**
     * @param  array<string, mixed>|null  $package
     */
    private function dependencyMajor(?array $package, string $name): ?int
    {
        if ($package === null) {
            return null;
        }

        foreach (['dependencies', 'devDependencies'] as $section) {
            $raw = $package[$section][$name] ?? null;
            if (! is_string($raw) || preg_match('/(\d+)/', $raw, $match) !== 1) {
                continue;
            }

            return (int) $match[1];
        }

        return null;
    }

    private function majorFromVersionFile(?string $content): ?string
    {
        if ($content === null) {
            return null;
        }

        $line = trim(strtok($content, "\r\n") ?: '');
        if ($line === '' || str_starts_with($line, '#') || str_contains(strtolower($line), 'lts')) {
            return null;
        }

        return $this->normalizeMajor($line);
    }

    private function nixpacksTomlVersion(?string $toml): ?string
    {
        if ($toml === null || $toml === '') {
            return null;
        }

        if (preg_match('/NIXPACKS_NODE_VERSION\s*=\s*["\']?(\d+(?:\.\d+)*)/i', $toml, $match) === 1) {
            return $match[1];
        }

        return null;
    }

    private function unredactConstraint(string $constraint, string $currentMajor): string
    {
        $major = $this->normalizeMajor($currentMajor) ?? self::DEFAULT;

        return (string) preg_replace('/<?REDACTED>?/i', $major, $constraint);
    }

    public function versionSatisfies(string $version, string $constraint): bool
    {
        $normalizedVersion = $this->padVersion($version);
        $alternatives = preg_split('/\s*\|\|\s*/', trim($constraint)) ?: [];

        foreach ($alternatives as $alternative) {
            if ($this->versionSatisfiesAllComparators($normalizedVersion, $alternative)) {
                return true;
            }
        }

        return false;
    }

    private function versionSatisfiesAllComparators(string $version, string $clause): bool
    {
        $clause = trim($clause);
        if ($clause === '' || $clause === '*') {
            return true;
        }

        if (preg_match_all('/(\^|~|>=|<=|>|<|=)?\s*v?(\d+(?:\.\d+)*|x|\*)/i', $clause, $matches, PREG_SET_ORDER) === 0 || $matches === []) {
            return false;
        }

        foreach ($matches as $match) {
            $operator = $match[1] === '' ? null : $match[1];
            $rawTarget = $match[2];

            if (! $this->compareOne($version, $operator, $rawTarget)) {
                return false;
            }
        }

        return true;
    }

    private function compareOne(string $version, ?string $operator, string $rawTarget): bool
    {
        if ($rawTarget === '*' || strtolower($rawTarget) === 'x') {
            return true;
        }

        $parts = array_map(fn (string $part): string => strtolower($part) === 'x' ? '0' : $part, explode('.', $rawTarget));
        $major = (int) ($parts[0] ?? 0);
        $minorSpecified = array_key_exists(1, $parts);
        $patchSpecified = array_key_exists(2, $parts);
        $target = $this->padVersion($rawTarget);

        return match ($operator) {
            '^' => version_compare($version, $this->padVersion((string) $major.($minorSpecified ? '.'.$parts[1] : '').($patchSpecified ? '.'.$parts[2] : '')), '>=')
                && version_compare($version, $this->padVersion((string) ($major + 1)), '<'),
            '~' => $this->satisfiesTilde($version, $major, $minorSpecified ? (int) $parts[1] : null, $patchSpecified ? (int) $parts[2] : null),
            '>=', '<=', '>', '<', '=' => version_compare($version, $target, $operator),
            default => $this->satisfiesBare($version, $major, $minorSpecified ? (int) $parts[1] : null, $patchSpecified ? (int) $parts[2] : null),
        };
    }

    private function satisfiesTilde(string $version, int $major, ?int $minor, ?int $patch): bool
    {
        $lower = $this->padVersion($major.($minor !== null ? '.'.$minor : '').($patch !== null ? '.'.$patch : ''));
        if (version_compare($version, $lower, '<')) {
            return false;
        }

        if ($minor === null) {
            return version_compare($version, $this->padVersion((string) ($major + 1)), '<');
        }

        return version_compare($version, $this->padVersion($major.'.'.($minor + 1)), '<');
    }

    private function satisfiesBare(string $version, int $major, ?int $minor, ?int $patch): bool
    {
        if ($minor === null) {
            return version_compare($version, $this->padVersion((string) $major), '>=')
                && version_compare($version, $this->padVersion((string) ($major + 1)), '<');
        }

        if ($patch === null) {
            return version_compare($version, $this->padVersion($major.'.'.$minor), '>=')
                && version_compare($version, $this->padVersion($major.'.'.($minor + 1)), '<');
        }

        return version_compare($version, $this->padVersion($major.'.'.$minor.'.'.$patch), '>=')
            && version_compare($version, $this->padVersion($major.'.'.$minor.'.'.($patch + 1)), '<');
    }

    private function padVersion(string $version): string
    {
        $version = ltrim($version, 'vV');
        $parts = preg_split('/\./', $version) ?: [];
        $parts = array_pad(array_slice($parts, 0, 3), 3, '0');

        return implode('.', array_map(fn (string $part): string => ctype_digit($part) ? (string) (int) $part : '0', $parts));
    }
}
