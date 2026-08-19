<?php

namespace Database\Factories;

use App\Models\StoreListing;
use App\Models\Team;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Str;

/**
 * @extends Factory<StoreListing>
 */
class StoreListingFactory extends Factory
{
    protected $model = StoreListing::class;

    public function definition(): array
    {
        $name = fake()->unique()->words(2, true);

        return [
            'slug' => Str::slug($name).'-'.fake()->unique()->numerify('###'),
            'name' => Str::title($name),
            'description' => fake()->sentence(),
            'category' => 'web',
            'team_id' => Team::factory(),
            'git_repository' => 'acme/demo-app',
            'git_branch' => 'main',
            'runtime_defaults' => [
                'build_pack' => 'nixpacks',
                'is_static' => false,
                'start_command' => null,
                'install_command' => null,
                'build_command' => null,
                'ports_exposes' => '3000',
                'base_directory' => '/',
                'publish_directory' => '/',
                'detected_framework' => null,
                'health_check_enabled' => true,
                'health_check_type' => 'http',
                'health_check_path' => '/',
                'health_check_port' => null,
            ],
            'env_schema' => [],
            'status' => StoreListing::STATUS_PUBLISHED,
            'install_count' => 0,
        ];
    }

    public function unpublished(): static
    {
        return $this->state(fn (): array => [
            'status' => StoreListing::STATUS_UNPUBLISHED,
        ]);
    }
}
