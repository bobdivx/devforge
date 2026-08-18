<?php

use App\Models\OauthSetting;
use Illuminate\Database\Migrations\Migration;

return new class extends Migration
{
    public function up(): void
    {
        OauthSetting::query()->firstOrCreate([
            'provider' => 'pocketid',
        ]);
    }

    public function down(): void
    {
        OauthSetting::query()->where('provider', 'pocketid')->delete();
    }
};
