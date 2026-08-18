<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('instance_settings', function (Blueprint $table) {
            if (! Schema::hasColumn('instance_settings', 'sso_protect_apps_by_default')) {
                $table->boolean('sso_protect_apps_by_default')->default(true);
            }
            if (! Schema::hasColumn('instance_settings', 'sso_forward_auth_address')) {
                $table->string('sso_forward_auth_address')->nullable();
            }
            if (! Schema::hasColumn('instance_settings', 'sso_hide_local_login')) {
                $table->boolean('sso_hide_local_login')->default(false);
            }
        });
    }

    public function down(): void
    {
        Schema::table('instance_settings', function (Blueprint $table) {
            $columns = collect(['sso_protect_apps_by_default', 'sso_forward_auth_address', 'sso_hide_local_login'])
                ->filter(fn (string $column): bool => Schema::hasColumn('instance_settings', $column))
                ->all();

            if ($columns !== []) {
                $table->dropColumn($columns);
            }
        });
    }
};
