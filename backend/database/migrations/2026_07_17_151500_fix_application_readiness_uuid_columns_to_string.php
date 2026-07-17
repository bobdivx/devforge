<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Align readiness UUID columns with BaseModel Cuid2 (string), in case
 * 2026_07_17_073200 already ran with native Postgres uuid columns.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('application_readiness')) {
            return;
        }

        $this->changeColumnToString('application_readiness', 'uuid');
        $this->changeColumnToString('application_readiness_interventions', 'uuid');
        $this->changeColumnToString('application_readiness_interventions', 'agent_run_uuid', nullable: true);
    }

    public function down(): void
    {
        // Irreversible intentionally — Cuid2 cannot round-trip to native uuid.
    }

    private function changeColumnToString(string $table, string $column, bool $nullable = false): void
    {
        if (! Schema::hasColumn($table, $column)) {
            return;
        }

        $driver = Schema::getConnection()->getDriverName();

        if ($driver === 'pgsql') {
            DB::statement("ALTER TABLE {$table} ALTER COLUMN {$column} TYPE varchar(255) USING {$column}::text");
            if ($nullable) {
                DB::statement("ALTER TABLE {$table} ALTER COLUMN {$column} DROP NOT NULL");
            } else {
                DB::statement("ALTER TABLE {$table} ALTER COLUMN {$column} SET NOT NULL");
            }

            return;
        }

        Schema::table($table, function (Blueprint $blueprint) use ($column, $nullable): void {
            $blueprint->string($column)->nullable($nullable)->change();
        });
    }
};
