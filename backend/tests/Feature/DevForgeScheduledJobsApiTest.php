<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class DevForgeScheduledJobsApiTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->user = User::factory()->create();
    }

    public function test_can_list_scheduled_jobs()
    {
        $response = $this->actingAs($this->user)->getJson('/api/devforge/v1/settings/scheduled-jobs');

        $response->assertStatus(200);
        $response->assertJsonStructure([
            'data' => [
                'executions',
                'skips' => [
                    'logs',
                    'totalCount',
                    'hasPrev',
                    'hasNext',
                    'currentPage',
                ],
                'managerRuns',
            ]
        ]);
    }
}
