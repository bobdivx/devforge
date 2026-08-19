<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasColumn('applications', 'has_own_user_system')) {
            Schema::table('applications', function (Blueprint $table) {
                $table->boolean('has_own_user_system')->nullable()->after('is_sso_protected');
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasColumn('applications', 'has_own_user_system')) {
            Schema::table('applications', function (Blueprint $table) {
                $table->dropColumn('has_own_user_system');
            });
        }
    }
};
