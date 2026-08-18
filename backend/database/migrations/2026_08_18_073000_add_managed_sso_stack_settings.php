<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('instance_settings', function (Blueprint $table) {
            $table->string('sso_pocket_id_url')->nullable();
            $table->string('sso_oauth2_proxy_url')->nullable();
            $table->text('sso_static_api_key')->nullable();
            $table->text('sso_encryption_key')->nullable();
            $table->text('sso_oauth2_cookie_secret')->nullable();
            $table->string('sso_apps_client_id')->nullable();
            $table->text('sso_apps_client_secret')->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('instance_settings', function (Blueprint $table) {
            $table->dropColumn([
                'sso_pocket_id_url',
                'sso_oauth2_proxy_url',
                'sso_static_api_key',
                'sso_encryption_key',
                'sso_oauth2_cookie_secret',
                'sso_apps_client_id',
                'sso_apps_client_secret',
            ]);
        });
    }
};
