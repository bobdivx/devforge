<?php

namespace App\Services\DevForge\Tag;

use App\Models\Tag;
use App\Models\Team;
use Illuminate\Validation\ValidationException;

class TagWriter
{
    public function create(Team $team, string $name): Tag
    {
        $normalized = strtolower(strip_tags(trim($name)));

        if (strlen($normalized) < 2) {
            throw ValidationException::withMessages([
                'name' => ['Tag names must be at least 2 characters long.'],
            ]);
        }

        $existing = Tag::query()
            ->where('team_id', $team->id)
            ->where('name', $normalized)
            ->first();

        if ($existing) {
            return $existing;
        }

        return Tag::query()->create([
            'name' => $normalized,
            'team_id' => $team->id,
        ]);
    }

    public function delete(Team $team, string $tagName): void
    {
        $tag = Tag::query()
            ->where('team_id', $team->id)
            ->where('name', strtolower($tagName))
            ->firstOrFail();

        if ($tag->applications()->exists() || $tag->services()->exists()) {
            throw ValidationException::withMessages([
                'tag' => ['Detach all applications and services before deleting this tag.'],
            ]);
        }

        $tag->delete();
    }
}
