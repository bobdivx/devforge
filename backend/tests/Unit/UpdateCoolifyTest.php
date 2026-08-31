<?php

use App\Actions\Server\UpdateCoolify;
use App\Actions\Server\UpdateDevForge;

it('has UpdateCoolify action class extending UpdateDevForge', function () {
    expect(class_exists(UpdateCoolify::class))->toBeTrue()
        ->and(is_subclass_of(UpdateCoolify::class, UpdateDevForge::class))->toBeTrue();
});
