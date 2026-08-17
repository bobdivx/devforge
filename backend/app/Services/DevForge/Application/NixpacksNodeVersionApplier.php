<?php

namespace App\Services\DevForge\Application;

use App\Models\Application;
use App\Models\EnvironmentVariable;

class NixpacksNodeVersionApplier
{
    public function __construct(
        private readonly NixpacksNodeVersionResolver $resolver,
    ) {}

    public function keyFor(Application $application): string
    {
        return $application->build_pack === 'railpack'
            ? 'RAILPACK_NODE_VERSION'
            : 'NIXPACKS_NODE_VERSION';
    }

    public function current(Application $application): ?string
    {
        $variable = $application->environment_variables()
            ->where('key', $this->keyFor($application))
            ->first();

        if (! $variable instanceof EnvironmentVariable) {
            return null;
        }

        $value = trim((string) $variable->value);

        return $value === '' ? null : $value;
    }

    public function apply(Application $application, string $version, string $comment = NixpacksNodeVersionResolver::AUTO_COMMENT): bool
    {
        $major = $this->resolver->normalizeMajor($version) ?? $version;
        $key = $this->keyFor($application);
        $changed = false;

        $production = $application->environment_variables()->where('key', $key)->first();
        if ($production instanceof EnvironmentVariable) {
            if ((string) $production->value !== $major) {
                $production->value = $major;
                $production->is_buildtime = true;
                $production->is_runtime = false;
                $production->comment = $comment;
                $production->save();
                $changed = true;
            }
        } else {
            $application->environment_variables()->create([
                'key' => $key,
                'value' => $major,
                'is_preview' => false,
                'is_multiline' => false,
                'is_literal' => false,
                'is_buildtime' => true,
                'is_runtime' => false,
                'comment' => $comment,
                'resourceable_type' => Application::class,
                'resourceable_id' => $application->id,
            ]);
            $changed = true;
        }

        $preview = $application->environment_variables_preview()->where('key', $key)->first();
        if ($preview instanceof EnvironmentVariable && (string) $preview->value !== $major) {
            $preview->value = $major;
            $preview->is_buildtime = true;
            $preview->is_runtime = false;
            $preview->comment = $comment;
            $preview->save();
            $changed = true;
        }

        return $changed;
    }
}
