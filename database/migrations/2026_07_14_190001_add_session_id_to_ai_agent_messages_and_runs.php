<?php

use App\Models\AiAgent;
use App\Models\AiAgentMessage;
use App\Models\AiAgentSession;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('ai_agent_messages', function (Blueprint $table) {
            $table->foreignId('session_id')
                ->nullable()
                ->after('agent_id')
                ->constrained('ai_agent_sessions')
                ->cascadeOnDelete();

            $table->index(['session_id', 'created_at']);
        });

        Schema::table('ai_agent_runs', function (Blueprint $table) {
            $table->foreignId('session_id')
                ->nullable()
                ->after('agent_id')
                ->constrained('ai_agent_sessions')
                ->nullOnDelete();
        });

        $this->migrateLegacyMessages();
    }

    public function down(): void
    {
        Schema::table('ai_agent_runs', function (Blueprint $table) {
            $table->dropConstrainedForeignId('session_id');
        });

        Schema::table('ai_agent_messages', function (Blueprint $table) {
            $table->dropConstrainedForeignId('session_id');
        });
    }

    private function migrateLegacyMessages(): void
    {
        if (! Schema::hasTable('ai_agent_messages') || ! Schema::hasTable('ai_agent_sessions')) {
            return;
        }

        $agentIds = AiAgentMessage::query()
            ->whereNull('session_id')
            ->distinct()
            ->pluck('agent_id');

        foreach ($agentIds as $agentId) {
            if (! AiAgent::query()->whereKey($agentId)->exists()) {
                continue;
            }

            $session = AiAgentSession::query()->create([
                'uuid' => (string) Str::uuid(),
                'agent_id' => $agentId,
                'user_id' => null,
                'title' => 'Historique',
                'last_message_at' => AiAgentMessage::query()
                    ->where('agent_id', $agentId)
                    ->whereNull('session_id')
                    ->max('created_at'),
            ]);

            AiAgentMessage::query()
                ->where('agent_id', $agentId)
                ->whereNull('session_id')
                ->update(['session_id' => $session->id]);
        }
    }
};
