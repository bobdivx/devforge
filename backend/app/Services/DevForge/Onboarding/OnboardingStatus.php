<?php

namespace App\Services\DevForge\Onboarding;

use App\Models\GithubApp;
use App\Models\InstanceSettings;
use App\Models\S3Storage;
use App\Models\Server;
use App\Models\Team;
use App\Services\DevForge\Sso\SsoProtection;

class OnboardingStatus
{
    /**
     * @return array{account: bool, domain: bool, sso: bool, github: bool, s3: bool, server: bool}
     */
    public function steps(Team $team): array
    {
        return [
            'account' => true,
            'domain' => $this->hasConfiguredDomain(),
            'sso' => $this->hasConfiguredSso(),
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

    private function hasConfiguredDomain(): bool
    {
        $settings = InstanceSettings::query()->whereKey(0)->first();

        return filled($settings?->apps_wildcard_domain);
    }

    private function hasConfiguredSso(): bool
    {
        $settings = InstanceSettings::query()->whereKey(0)->first();

        return SsoProtection::pocketIdLoginEnabled() || filled($settings?->sso_forward_auth_address);
    }
}
