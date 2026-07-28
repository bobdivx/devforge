<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('ai_agent_standing_orders', function (Blueprint $table) {
            $table->id();
            $table->foreignId('team_id')->constrained()->cascadeOnDelete();
            $table->foreignId('agent_id')->nullable()->constrained('ai_agents')->nullOnDelete();
            $table->string('resource_uuid')->nullable()->index();
            $table->string('title');
            $table->string('scope')->default('app');
            $table->json('triggers')->nullable();
            $table->text('approval_gates')->nullable();
            $table->text('escalation')->nullable();
            $table->longText('body');
            $table->unsignedInteger('priority')->default(0);
            $table->boolean('is_active')->default(true);
            $table->timestamps();

            $table->index(['team_id', 'is_active']);
        });

        Schema::table('ai_agents', function (Blueprint $table) {
            $table->string('schedule_cron')->nullable()->after('schedule_minutes');
            $table->boolean('heartbeat_enabled')->default(false)->after('schedule_cron');
            $table->timestamp('last_heartbeat_at')->nullable()->after('heartbeat_enabled');
        });
    }

    public function down(): void
    {
        Schema::table('ai_agents', function (Blueprint $table) {
            $table->dropColumn(['schedule_cron', 'heartbeat_enabled', 'last_heartbeat_at']);
        });

        Schema::dropIfExists('ai_agent_standing_orders');
    }
};
