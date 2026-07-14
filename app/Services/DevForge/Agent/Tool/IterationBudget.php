<?php

namespace App\Services\DevForge\Agent\Tool;

/**
 * Budget d'itérations LLM — porté depuis forge-iteration-budget.ts (Forge).
 */
class IterationBudget
{
    public function __construct(private int $maxTotal = 30) {}

    public function consume(): bool
    {
        if ($this->used >= $this->maxTotal) {
            return false;
        }

        $this->used++;

        return true;
    }

    public function refund(): void
    {
        if ($this->used > 0) {
            $this->used--;
        }
    }

    public function getUsed(): int
    {
        return $this->used;
    }

    public function getRemaining(): int
    {
        return max(0, $this->maxTotal - $this->used);
    }

    private int $used = 0;
}
