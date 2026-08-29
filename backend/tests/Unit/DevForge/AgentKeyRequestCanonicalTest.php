<?php

use App\Models\AiAgentKeyRequest;

it('canonicalizes database url aliases', function () {
    expect(AiAgentKeyRequest::canonicalKeyName('astro_db_remote_url'))->toBe('DATABASE_URL')
        ->and(AiAgentKeyRequest::canonicalKeyName('TURSO_DATABASE_URL'))->toBe('DATABASE_URL')
        ->and(AiAgentKeyRequest::canonicalKeyName('DATABASE_URL_MACOMPTA'))->toBe('DATABASE_URL')
        ->and(AiAgentKeyRequest::canonicalKeyName('ADMIN_SECRET_KEY'))->toBe('ADMIN_SECRET_KEY')
        ->and(AiAgentKeyRequest::aliasKeyNames('CORRECT_DB_URL'))->toContain('DATABASE_URL')
        ->and(AiAgentKeyRequest::aliasKeyNames('CORRECT_DB_URL'))->toContain('ASTRO_DB_REMOTE_URL');
});
