<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('ai_agent_key_requests')) {
            return;
        }

        Schema::table('ai_agent_key_requests', function (Blueprint $table): void {
            if (! Schema::hasColumn('ai_agent_key_requests', 'kind')) {
                $table->string('kind', 32)->default('secret')->after('key_name');
            }
            if (! Schema::hasColumn('ai_agent_key_requests', 'resource_uuid')) {
                $table->string('resource_uuid', 64)->nullable()->after('kind');
            }
            if (! Schema::hasColumn('ai_agent_key_requests', 'mission_uuid')) {
                $table->string('mission_uuid', 64)->nullable()->after('resource_uuid');
            }
            if (! Schema::hasColumn('ai_agent_key_requests', 'resolved_at')) {
                $table->timestamp('resolved_at')->nullable()->after('status');
            }
        });
    }

    public function down(): void
    {
        if (! Schema::hasTable('ai_agent_key_requests')) {
            return;
        }

        Schema::table('ai_agent_key_requests', function (Blueprint $table): void {
            foreach (['kind', 'resource_uuid', 'mission_uuid', 'resolved_at'] as $column) {
                if (Schema::hasColumn('ai_agent_key_requests', $column)) {
                    $table->dropColumn($column);
                }
            }
        });
    }
};
