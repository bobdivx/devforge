<?php

namespace Database\Factories;

use App\Models\AiAgent;
use App\Models\AiAgentSession;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<AiAgentSession>
 */
class AiAgentSessionFactory extends Factory
{
    protected $model = AiAgentSession::class;

    public function definition(): array
    {
        return [
            'agent_id' => AiAgent::factory(),
            'user_id' => User::factory(),
            'title' => $this->faker->sentence(3),
            'last_message_at' => now(),
        ];
    }

    public function legacy(): static
    {
        return $this->state(fn () => [
            'user_id' => null,
            'title' => 'Historique',
        ]);
    }
}
