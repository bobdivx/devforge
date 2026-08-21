<?php

namespace Database\Factories;

use App\Models\AiAgent;
use App\Models\AiProviderConfig;
use App\Models\Team;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<AiAgent>
 */
class AiAgentFactory extends Factory
{
    protected $model = AiAgent::class;

    public function definition(): array
    {
        $colors = ['#6366f1', '#ec4899', '#f59e0b', '#10b981', '#3b82f6', '#ef4444'];

        return [
            'team_id' => Team::factory(),
            'provider_config_id' => AiProviderConfig::factory(),
            'fallback_provider_config_id' => null,
            'parent_agent_id' => null,
            'resource_uuid' => null,
            'type' => $this->faker->randomElement(['debug', 'tech-watch', 'github', 'github-actions', 'devforge', 'deployment', 'security']),
            'name' => $this->faker->name().' Agent',
            'description' => $this->faker->sentence(),
            'avatar_color' => $this->faker->randomElement($colors),
            'avatar_shape' => $this->faker->randomElement(['circle', 'squircle', 'oval', 'pill', 'triangle', 'hexagon', 'cloud']),
            'system_prompt' => null,
            'schedule_minutes' => $this->faker->randomElement([0, 15, 30, 60, 360]),
            'is_active' => true,
            'status' => 'idle',
            'last_run_at' => null,
            'metadata' => null,
        ];
    }

    public function debug(): static
    {
        return $this->state(fn () => ['type' => 'debug', 'schedule_minutes' => 15]);
    }

    public function deployment(): static
    {
        return $this->state(fn () => ['type' => 'deployment', 'schedule_minutes' => 10]);
    }

    public function devforge(): static
    {
        return $this->state(fn () => ['type' => 'devforge', 'schedule_minutes' => 0]);
    }

    public function paused(): static
    {
        return $this->state(fn () => ['is_active' => false, 'status' => 'paused']);
    }

    public function running(): static
    {
        return $this->state(fn () => ['status' => 'running']);
    }

    public function subAgent(AiAgent $parent, string $resourceUuid): static
    {
        return $this->state(fn () => [
            'parent_agent_id' => $parent->id,
            'resource_uuid' => $resourceUuid,
            'team_id' => $parent->team_id,
        ]);
    }
}
