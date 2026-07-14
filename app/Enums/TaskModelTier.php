<?php

namespace App\Enums;

enum TaskModelTier: string
{
    case Light = 'light';
    case Standard = 'standard';
    case Heavy = 'heavy';

    public function label(): string
    {
        return match ($this) {
            self::Light => 'Léger',
            self::Standard => 'Standard',
            self::Heavy => 'Complexe',
        };
    }

    public function modelLabel(): string
    {
        return match ($this) {
            self::Light => 'Flash-Lite',
            self::Standard => 'Flash',
            self::Heavy => 'Pro',
        };
    }

    public static function tryFromLoose(?string $value): ?self
    {
        if ($value === null || $value === '' || $value === 'auto') {
            return null;
        }

        return self::tryFrom(mb_strtolower(trim($value)));
    }
}
