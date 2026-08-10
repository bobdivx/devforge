<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasColumn('instance_settings', 'agents_features')) {
            Schema::table('instance_settings', function (Blueprint $table) {
                $table->json('agents_features')->nullable()->after('is_mcp_server_enabled');
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasColumn('instance_settings', 'agents_features')) {
            Schema::table('instance_settings', function (Blueprint $table) {
                $table->dropColumn('agents_features');
            });
        }
    }
};
