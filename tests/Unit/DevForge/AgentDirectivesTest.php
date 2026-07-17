<?php

use App\Models\AiAgent;
use App\Models\Team;
use App\Services\DevForge\Agent\AgentChatRepairStrategy;
use App\Services\DevForge\Agent\AgentDirectives;
use App\Services\DevForge\Agent\AgentPromptBuilder;

it('provides autonomous playbook steps per agent type', function () {
    $playbook = AgentDirectives::autonomousPlaybook('debug');

    expect($playbook)->toBeArray()
        ->and(count($playbook))->toBeGreaterThan(2)
        ->and($playbook[0])->toContain('list_resources');
});

it('builds autonomous initial message with playbook', function () {
    $agent = AiAgent::factory()->debug()->make([
        'name' => 'Debug Test',
        'team_id' => 1,
    ]);
    $agent->setRelation('team', Team::factory()->make(['name' => 'Equipe Test']));

    $message = app(AgentPromptBuilder::class)->autonomousInitialMessage($agent, [], 'manual');

    expect($message)->toContain('DÉMARRAGE AUTONOME')
        ->and($message)->toContain('list_resources')
        ->and($message)->toContain('Playbook');
});

it('requires tool usage in autonomy rules', function () {
    expect(AgentDirectives::autonomyRules())->toContain('première action DOIT être un appel d\'outil');
});

it('requires immediate tool usage in chat autonomy rules', function () {
    expect(AgentDirectives::chatAutonomyRules())->toContain('première réponse à une demande actionnable DOIT inclure');
});

it('teaches failure playbook to use upsert_application_env_var and stop after deploy queue', function () {
    $agent = AiAgent::factory()->debug()->make([
        'name' => 'Debug Test',
        'team_id' => 1,
    ]);
    $agent->setRelation('team', Team::factory()->make(['name' => 'Equipe Test']));

    $system = app(AgentPromptBuilder::class)->autonomousSystemPrompt($agent, [
        'event' => 'deployment_failed',
    ]);
    $message = app(AgentPromptBuilder::class)->autonomousInitialMessage($agent, [
        'event' => 'deployment_failed',
        'application_name' => 'starbasefr',
        'application_uuid' => 'app-uuid',
        'deployment_uuid' => 'deploy-uuid',
        'commit' => 'abc123',
        'failure_excerpt' => ['PUPPETEER_SKIP_DOWNLOAD'],
    ], 'event');

    expect($system)->toContain('upsert_application_env_var')
        ->and($system)->toContain('update_application_git_branch')
        ->and($system)->toContain('update_application_runtime_settings')
        ->and($system)->toContain('fix_application_host_permissions')
        ->and($system)->toContain('Permission denied')
        ->and($system)->toContain('DUMMY_')
        ->and($system)->toContain('ARRÊTE')
        ->and($message)->toContain('upsert_application_env_var')
        ->and($message)->toContain('update_application_git_branch')
        ->and($message)->toContain('update_application_runtime_settings')
        ->and($message)->toContain('fix_application_host_permissions')
        ->and($message)->toContain('JAMAIS write_application_source sur .env')
        ->and($message)->toContain('STOP');
});

it('nudges failure agents that stop after diagnosis only', function () {
    expect(AgentDirectives::deploymentFailureCorrectionNudgeMessage())
        ->toContain('update_application_runtime_settings')
        ->and(AgentDirectives::deploymentFailureCorrectionNudgeMessage())
        ->toContain('DUMMY_');
});

it('detects host permission diagnoses and provides an ops nudge', function () {
    $text = 'Permission denied lors de l\'écriture dans data/applications — ownership host.';

    expect(AgentDirectives::isHostPermissionDiagnosis($text))->toBeTrue()
        ->and(AgentDirectives::isHostPermissionDiagnosis('npm ERR! missing script'))->toBeFalse()
        ->and(AgentDirectives::isHostPermissionDiagnosis('Les logs suggèrent un problème lié à la création d\'un fichier .env'))->toBeTrue()
        ->and(AgentDirectives::failureExcerptHasHostPermissionIssue([
            ['message' => 'tee: /media/Docker/AppData/coolify/data/applications/x/.env: Permission denied'],
        ]))->toBeTrue()
        ->and(AgentDirectives::failureExcerptHasHostPermissionIssue([
            ['message' => 'npm ERR! missing script: build'],
        ]))->toBeFalse()
        ->and(AgentDirectives::deploymentFailureHostPermissionNudgeMessage())->toContain('fix_application_host_permissions')
        ->and(AgentDirectives::deploymentFailureHostPermissionNudgeMessage())->toContain('DUMMY_')
        ->and(AgentDirectives::deploymentFailureHostPermissionNudgeMessage())->not->toContain('send_notification sans fix');
});

it('detects Coolify BASE_CONFIG_PATH / read-only failures without hardcoded host paths', function () {
    expect(AgentDirectives::isCoolifyBaseConfigPathIssue(
        "mkdir coolify/applications/x: Read-only file system"
    ))->toBeTrue()
        ->and(AgentDirectives::isCoolifyBaseConfigPathIssue(
            "mkdir: cannot create directory '/data': Read-only file system"
        ))->toBeFalse()
        ->and(AgentDirectives::isCoolifyBaseConfigPathIssue('tee: Permission denied'))->toBeFalse()
        ->and(AgentDirectives::failureExcerptHasCoolifyBaseConfigPathIssue([
            ['message' => 'sudo mkdir -p /media/Docker/AppData/coolify/data/applications/x'],
            ['message' => 'Read-only file system'],
        ]))->toBeTrue()
        ->and(AgentDirectives::failureExcerptHasCoolifyBaseConfigPathIssue([
            ['message' => 'sudo mkdir -p /var/custom/coolify/applications/x'],
            ['message' => "mkdir: cannot create directory '/var': Read-only file system"],
        ]))->toBeTrue();
});

it('detects missing static publish_directory / nginx welcome failures', function () {
    expect(AgentDirectives::isMissingStaticPublishDirectoryIssue('Welcome to nginx!'))->toBeTrue()
        ->and(AgentDirectives::isMissingStaticPublishDirectoryIssue('Page nginx par défaut détectée'))->toBeTrue()
        ->and(AgentDirectives::isMissingStaticPublishDirectoryIssue('npm ERR! missing script'))->toBeFalse()
        ->and(AgentDirectives::inferStaticPublishDirectory([
            ['message' => '[build] directory: /app/dist/'],
        ]))->toBe('/dist')
        ->and(AgentDirectives::inferStaticPublishDirectory([
            ['message' => '[build] directory: /app/build/'],
        ]))->toBe('/build')
        ->and(AgentDirectives::inferStaticPublishDirectory([
            ['message' => 'astro build complete'],
        ]))->toBe('/dist')
        ->and(AgentDirectives::inferStaticPublishDirectory([
            ['message' => 'npm ERR! missing script'],
        ]))->toBeNull()
        ->and(AgentDirectives::pickStaticPublishDirectoryFromSourceEntries([
            ['name' => 'src', 'type' => 'directory'],
            ['name' => 'dist', 'type' => 'directory'],
            ['name' => 'package.json', 'type' => 'file'],
        ]))->toBe('/dist')
        ->and(AgentDirectives::pickStaticPublishDirectoryFromSourceEntries([
            ['name' => 'src', 'type' => 'directory'],
        ]))->toBeNull()
        ->and(AgentChatRepairStrategy::detectIssue(mb_strtolower(
            'Page nginx par défaut détectée (publish_directory probablement incorrect, ex. /dist manquant).'
        )))->toBe(AgentChatRepairStrategy::ISSUE_NGINX_PUBLISH);
});

it('detects ApplicationReadiness platform crashes and invalid chown groups', function () {
    expect(AgentDirectives::isReadinessPlatformCrash('Class "App\\Models\\ApplicationReadiness" not found'))->toBeTrue()
        ->and(AgentDirectives::failureExcerptHasReadinessPlatformCrash([
            ['message' => 'Deployment failed: Class "App\\Models\\ApplicationReadiness" not found'],
        ]))->toBeTrue()
        ->and(AgentDirectives::isInvalidChownGroupIssue("chown: invalid group: 'bobdivx:bobdivx'"))->toBeTrue()
        ->and(AgentDirectives::isInvalidChownGroupIssue('Permission denied'))->toBeFalse();
});

it('detects npm private registry E401 failures', function () {
    $log = 'npm error code E401\nnpm error 401 Unauthorized - GET https://npm.pkg.github.com/download/@Briseteia/ma-prusa-design-system/0.0.47 — unauthenticated: User cannot be authenticated';

    expect(AgentDirectives::isNpmPrivateRegistryAuthIssue($log))->toBeTrue()
        ->and(AgentChatRepairStrategy::detectIssue(mb_strtolower($log)))->toBe(AgentChatRepairStrategy::ISSUE_NPM_AUTH)
        ->and(AgentDirectives::isNpmPrivateRegistryAuthIssue('npm ERR! missing script: build'))->toBeFalse();
});

it('mentions github app packages injection in deployment failure prompts', function () {
    $agent = new AiAgent([
        'type' => 'deployment',
        'name' => 'Deploy Test',
        'team_id' => 1,
    ]);
    $agent->setRelation('team', Team::factory()->make(['name' => 'Equipe Test']));

    $system = app(AgentPromptBuilder::class)->autonomousSystemPrompt($agent, [
        'event' => 'deployment_failed',
    ]);

    expect($system)->toContain('GitHub')
        ->and($system)->toContain('NODE_AUTH_TOKEN');
});

it('builds readiness failure prompts with structured outcome instructions', function () {
    $agent = new AiAgent([
        'type' => 'deployment',
        'name' => 'Deploy Test',
        'team_id' => 1,
    ]);
    $agent->setRelation('team', Team::factory()->make(['name' => 'Equipe Test']));

    $system = app(AgentPromptBuilder::class)->autonomousSystemPrompt($agent, [
        'event' => 'application_readiness_failed',
    ]);
    $message = app(AgentPromptBuilder::class)->autonomousInitialMessage($agent, [
        'event' => 'application_readiness_failed',
        'application_name' => 'macompta',
        'application_uuid' => 'app-uuid',
        'deployment_uuid' => 'deploy-uuid',
        'fqdn' => 'https://macompta.example.com',
        'probe_url' => 'https://macompta.example.com',
        'probe_status' => 502,
        'probe_error' => 'HTTP 502',
        'readiness_round' => 1,
        'readiness_max_rounds' => 5,
    ], 'event');

    expect($system)->toContain('outcome')
        ->and($system)->toContain('needs_user')
        ->and($system)->toContain('publish_directory')
        ->and($message)->toContain('ALERTE READINESS')
        ->and($message)->toContain('http_request')
        ->and($message)->toContain('publish_directory');
});
