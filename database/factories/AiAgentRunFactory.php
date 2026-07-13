<?php

namespace Database\Factories;

use App\Models\AiAgent;
use App\Models\AiAgentRun;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<AiAgentRun>
 */
class AiAgentRunFactory extends Factory
{
    protected $model = AiAgentRun::class;

    public function definition(): array
    {
        $startedAt = $this->faker->dateTimeBetween('-1 hour', 'now');

        return [
            'agent_id' => AiAgent::factory(),
            'status' => 'completed',
            'trigger' => $this->faker->randomElement(['scheduled', 'manual']),
            'summary' => $this->faker->sentence(),
            'actions_taken' => [],
            'logs' => null,
            'tokens_used' => $this->faker->numberBetween(100, 5000),
            'iterations' => $this->faker->numberBetween(1, 8),
            'started_at' => $startedAt,
            'finished_at' => (clone $startedAt)->modify('+'.rand(10, 120).' seconds'),
        ];
    }

    public function pending(): static
    {
        return $this->state(fn () => [
            'status' => 'pending',
            'started_at' => null,
            'finished_at' => null,
        ]);
    }

    public function running(): static
    {
        return $this->state(fn () => [
            'status' => 'running',
            'started_at' => now(),
            'finished_at' => null,
        ]);
    }

    public function failed(): static
    {
        return $this->state(fn () => ['status' => 'failed']);
    }
}
