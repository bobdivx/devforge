<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasColumn('application_settings', 'is_image_auto_update_enabled')) {
            Schema::table('application_settings', function (Blueprint $table) {
                $table->boolean('is_image_auto_update_enabled')->default(false);
            });
        }

        if (! Schema::hasColumn('services', 'is_image_auto_update_enabled')) {
            Schema::table('services', function (Blueprint $table) {
                $table->boolean('is_image_auto_update_enabled')->default(false);
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasColumn('application_settings', 'is_image_auto_update_enabled')) {
            Schema::table('application_settings', function (Blueprint $table) {
                $table->dropColumn('is_image_auto_update_enabled');
            });
        }

        if (Schema::hasColumn('services', 'is_image_auto_update_enabled')) {
            Schema::table('services', function (Blueprint $table) {
                $table->dropColumn('is_image_auto_update_enabled');
            });
        }
    }
};
