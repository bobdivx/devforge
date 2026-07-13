<?php

namespace Database\Factories;

use App\Models\AiProviderConfig;
use App\Models\Team;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<AiProviderConfig>
 */
class AiProviderConfigFactory extends Factory
{
    protected $model = AiProviderConfig::class;

    public function definition(): array
    {
        return [
            'team_id' => Team::factory(),
            'provider' => $this->faker->randomElement(['gemini', 'ollama']),
            'name' => $this->faker->words(2, true),
            'api_key' => $this->faker->uuid(),
            'base_url' => null,
            'model' => 'gemini-1.5-flash',
            'is_default' => false,
        ];
    }

    public function gemini(): static
    {
        return $this->state(fn () => [
            'provider' => 'gemini',
            'model' => 'gemini-1.5-flash',
            'base_url' => null,
        ]);
    }

    public function ollama(): static
    {
        return $this->state(fn () => [
            'provider' => 'ollama',
            'model' => 'llama3.2',
            'base_url' => 'http://localhost:11434',
            'api_key' => null,
        ]);
    }

    public function default(): static
    {
        return $this->state(fn () => ['is_default' => true]);
    }
}
