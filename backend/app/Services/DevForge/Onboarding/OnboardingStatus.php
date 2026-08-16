<?php

namespace App\Services\DevForge\Onboarding;

use App\Models\GithubApp;
use App\Models\S3Storage;
use App\Models\Server;
use App\Models\Team;

class OnboardingStatus
{
    /**
     * @return array{account: bool, github: bool, s3: bool, server: bool}
     */
    public function steps(Team $team): array
    {
        return [
            'account' => true,
            'github' => GithubApp::query()
                ->where('team_id', $team->id)
                ->where('is_public', false)
                ->whereNotNull('app_id')
                ->whereNotNull('installation_id')
                ->exists(),
            's3' => S3Storage::query()
                ->where('team_id', $team->id)
                ->exists(),
            'server' => Server::query()
                ->where('team_id', $team->id)
                ->exists(),
        ];
    }
}
