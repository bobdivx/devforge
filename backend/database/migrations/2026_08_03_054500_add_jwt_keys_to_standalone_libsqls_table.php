<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('standalone_libsqls', function (Blueprint $table) {
            $table->text('libsql_jwt_secret_key')->nullable()->after('libsql_auth_token');
            $table->text('libsql_jwt_public_key')->nullable()->after('libsql_jwt_secret_key');
        });
    }

    public function down(): void
    {
        Schema::table('standalone_libsqls', function (Blueprint $table) {
            $table->dropColumn(['libsql_jwt_secret_key', 'libsql_jwt_public_key']);
        });
    }
};
