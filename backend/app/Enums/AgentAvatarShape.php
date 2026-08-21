<?php

namespace App\Enums;

enum AgentAvatarShape: string
{
    case Circle = 'circle';
    case Squircle = 'squircle';
    case Oval = 'oval';
    case Rectangle = 'rectangle';
    case Pill = 'pill';
    case Triangle = 'triangle';
    case Hexagon = 'hexagon';
    case Cloud = 'cloud';
    case Teardrop = 'teardrop';

    /** @return list<string> */
    public static function values(): array
    {
        return array_column(self::cases(), 'value');
    }

    public static function defaultForType(string $type): self
    {
        return match ($type) {
            'deployment' => self::Circle,
            'debug' => self::Squircle,
            'tech-watch' => self::Hexagon,
            'github' => self::Oval,
            'github-actions' => self::Triangle,
            'devforge' => self::Cloud,
            'security' => self::Teardrop,
            default => self::Circle,
        };
    }

    public static function resolve(?string $value, string $type): self
    {
        $shape = self::tryFrom(is_string($value) ? $value : '');

        return $shape ?? self::defaultForType($type);
    }
}
