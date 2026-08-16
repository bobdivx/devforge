<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasColumn('instance_settings', 'apps_wildcard_domain')) {
            Schema::table('instance_settings', function (Blueprint $table) {
                $table->string('apps_wildcard_domain')->nullable()->after('fqdn');
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasColumn('instance_settings', 'apps_wildcard_domain')) {
            Schema::table('instance_settings', function (Blueprint $table) {
                $table->dropColumn('apps_wildcard_domain');
            });
        }
    }
};
