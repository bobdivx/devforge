<?php

namespace App\Services\DevForge\Agent;

use App\Models\Team;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\DB;

/**
 * Instructions en couches org / personnel / projet (DevForge).
 * Stockage : table `ai_agent_instruction_layers` si présente, sinon config.
 */
class AgentLayeredInstructions
{
    /**
     * @return array{org: string, personal: string, project: string}
     */
    public function load(?Team $team, ?string $userEmail = null, ?string $resourceUuid = null): array
    {
        return [
            'org' => $this->getOrg($team),
            'personal' => $this->getPersonal($team, $userEmail),
            'project' => $this->getProject($team, $resourceUuid),
        ];
    }

    public function compose(array $layers): string
    {
        $parts = [];
        if (($layers['org'] ?? '') !== '') {
            $parts[] = "INSTRUCTIONS ORGANISATION :\n".trim($layers['org']);
        }
        if (($layers['personal'] ?? '') !== '') {
            $parts[] = "INSTRUCTIONS PERSONNELLES :\n".trim($layers['personal']);
        }
        if (($layers['project'] ?? '') !== '') {
            $parts[] = "INSTRUCTIONS PROJET :\n".trim($layers['project']);
        }

        return implode("\n\n", $parts);
    }

    public function getOrg(?Team $team): string
    {
        if ($team === null) {
            return (string) config('devforge.agents_org_instructions', '');
        }

        return $this->readLayer($team->id, 'org', null, null)
            ?: (string) config('devforge.agents_org_instructions', '');
    }

    public function setOrg(Team $team, string $text): void
    {
        $this->writeLayer($team->id, 'org', null, null, $text);
    }

    public function getPersonal(?Team $team, ?string $email): string
    {
        $email = strtolower(trim((string) $email));
        if ($team === null || $email === '') {
            return '';
        }

        return $this->readLayer($team->id, 'personal', $email, null);
    }

    public function setPersonal(Team $team, string $email, string $text): void
    {
        $email = strtolower(trim($email));
        if ($email === '') {
            throw new \InvalidArgumentException('email requis');
        }
        $this->writeLayer($team->id, 'personal', $email, null, $text);
    }

    public function getProject(?Team $team, ?string $resourceUuid): string
    {
        $resourceUuid = trim((string) $resourceUuid);
        if ($team === null || $resourceUuid === '') {
            return '';
        }

        return $this->readLayer($team->id, 'project', null, $resourceUuid);
    }

    public function setProject(Team $team, string $resourceUuid, string $text): void
    {
        $resourceUuid = trim($resourceUuid);
        if ($resourceUuid === '') {
            throw new \InvalidArgumentException('resource_uuid requis');
        }
        $this->writeLayer($team->id, 'project', null, $resourceUuid, $text);
    }

    private function tableReady(): bool
    {
        try {
            return Schema::hasTable('ai_agent_instruction_layers');
        } catch (\Throwable) {
            return false;
        }
    }

    private function readLayer(int $teamId, string $scope, ?string $email, ?string $resourceUuid): string
    {
        if (! $this->tableReady()) {
            return '';
        }

        $query = DB::table('ai_agent_instruction_layers')
            ->where('team_id', $teamId)
            ->where('scope', $scope);

        if ($scope === 'personal') {
            $query->where('user_email', $email);
        } elseif ($scope === 'project') {
            $query->where('resource_uuid', $resourceUuid);
        } else {
            $query->whereNull('user_email')->whereNull('resource_uuid');
        }

        $row = $query->first();

        return trim((string) ($row->content ?? ''));
    }

    private function writeLayer(int $teamId, string $scope, ?string $email, ?string $resourceUuid, string $text): void
    {
        if (! $this->tableReady()) {
            if ($scope === 'org') {
                // Fallback config runtime (non persisté multi-tenant sans table).
                config(['devforge.agents_org_instructions' => trim($text)]);
            }

            return;
        }

        $payload = [
            'team_id' => $teamId,
            'scope' => $scope,
            'user_email' => $scope === 'personal' ? $email : null,
            'resource_uuid' => $scope === 'project' ? $resourceUuid : null,
            'content' => trim($text),
            'updated_at' => now(),
        ];

        $existing = DB::table('ai_agent_instruction_layers')
            ->where('team_id', $teamId)
            ->where('scope', $scope)
            ->when($scope === 'personal', fn ($q) => $q->where('user_email', $email))
            ->when($scope === 'project', fn ($q) => $q->where('resource_uuid', $resourceUuid))
            ->when($scope === 'org', fn ($q) => $q->whereNull('user_email')->whereNull('resource_uuid'))
            ->first();

        if ($existing) {
            DB::table('ai_agent_instruction_layers')->where('id', $existing->id)->update($payload);
        } else {
            $payload['created_at'] = now();
            DB::table('ai_agent_instruction_layers')->insert($payload);
        }
    }
}
