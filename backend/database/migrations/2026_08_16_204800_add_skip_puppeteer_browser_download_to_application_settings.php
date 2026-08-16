<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasColumn('application_settings', 'skip_puppeteer_browser_download')) {
            Schema::table('application_settings', function (Blueprint $table) {
                $table->boolean('skip_puppeteer_browser_download')->default(true);
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasColumn('application_settings', 'skip_puppeteer_browser_download')) {
            Schema::table('application_settings', function (Blueprint $table) {
                $table->dropColumn('skip_puppeteer_browser_download');
            });
        }
    }
};
