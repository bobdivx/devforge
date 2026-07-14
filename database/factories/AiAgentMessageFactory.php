<?php

namespace Database\Factories;

use App\Models\AiAgent;
use App\Models\AiAgentMessage;
use App\Models\AiAgentSession;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<AiAgentMessage>
 */
class AiAgentMessageFactory extends Factory
{
    protected $model = AiAgentMessage::class;

    public function definition(): array
    {
        return [
            'agent_id' => AiAgent::factory(),
            'session_id' => AiAgentSession::factory(),
            'run_id' => null,
            'role' => $this->faker->randomElement(['user', 'assistant']),
            'content' => $this->faker->sentence(),
            'metadata' => null,
        ];
    }

    public function user(): static
    {
        return $this->state(fn () => ['role' => 'user']);
    }

    public function assistant(): static
    {
        return $this->state(fn () => ['role' => 'assistant']);
    }
}
