<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('application_readiness', function (Blueprint $table) {
            $table->id();
            // BaseModel uses Cuid2 — must be string, not Postgres native uuid.
            $table->string('uuid')->unique();
            $table->foreignId('application_id')->unique()->constrained()->cascadeOnDelete();
            $table->string('status')->default('idle'); // idle|probing|healthy|recovering|awaiting_user|failed
            $table->boolean('autonomous_enabled')->default(true);
            $table->timestamp('last_probe_at')->nullable();
            $table->boolean('last_probe_ok')->nullable();
            $table->text('last_probe_error')->nullable();
            $table->unsignedSmallInteger('last_http_status')->nullable();
            $table->unsignedInteger('round')->default(0);
            $table->unsignedInteger('max_rounds')->default(5);
            $table->string('last_deployment_uuid')->nullable();
            $table->unsignedBigInteger('active_intervention_id')->nullable();
            $table->timestamps();

            $table->index(['status', 'autonomous_enabled']);
        });

        Schema::create('application_readiness_interventions', function (Blueprint $table) {
            $table->id();
            $table->string('uuid')->unique();
            $table->foreignId('application_id')->constrained()->cascadeOnDelete();
            $table->string('deployment_uuid')->nullable();
            $table->string('agent_run_uuid')->nullable();
            $table->string('title');
            $table->text('summary')->nullable();
            $table->json('steps');
            $table->string('status')->default('open'); // open|acknowledged|resolved|cancelled
            $table->timestamp('user_acknowledged_at')->nullable();
            $table->timestamp('resolved_at')->nullable();
            $table->timestamps();

            $table->index(['application_id', 'status']);
        });

        Schema::table('application_readiness', function (Blueprint $table) {
            $table->foreign('active_intervention_id')
                ->references('id')
                ->on('application_readiness_interventions')
                ->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('application_readiness', function (Blueprint $table) {
            $table->dropForeign(['active_intervention_id']);
        });
        Schema::dropIfExists('application_readiness_interventions');
        Schema::dropIfExists('application_readiness');
    }
};
