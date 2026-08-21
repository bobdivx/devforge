<?php

use App\Enums\AgentAvatarShape;

it('lists every supported bot shape', function () {
    expect(AgentAvatarShape::values())->toEqual([
        'circle',
        'squircle',
        'oval',
        'rectangle',
        'pill',
        'triangle',
        'hexagon',
        'cloud',
        'teardrop',
    ]);
});

it('defaults a shape for each agent type', function (string $type, string $shape) {
    expect(AgentAvatarShape::defaultForType($type)->value)->toBe($shape);
})->with([
    ['deployment', 'circle'],
    ['debug', 'squircle'],
    ['tech-watch', 'hexagon'],
    ['github', 'oval'],
    ['github-actions', 'triangle'],
    ['devforge', 'cloud'],
    ['security', 'teardrop'],
    ['unknown', 'circle'],
]);

it('resolves blank or invalid shapes to the type default', function () {
    expect(AgentAvatarShape::resolve(null, 'security')->value)->toBe('teardrop')
        ->and(AgentAvatarShape::resolve('robot', 'debug')->value)->toBe('squircle')
        ->and(AgentAvatarShape::resolve('pill', 'debug')->value)->toBe('pill');
});
