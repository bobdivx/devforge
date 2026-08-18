<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasColumn('applications', 'is_sso_protected')) {
            Schema::table('applications', function (Blueprint $table) {
                $table->boolean('is_sso_protected')->nullable();
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasColumn('applications', 'is_sso_protected')) {
            Schema::table('applications', function (Blueprint $table) {
                $table->dropColumn('is_sso_protected');
            });
        }
    }
};
