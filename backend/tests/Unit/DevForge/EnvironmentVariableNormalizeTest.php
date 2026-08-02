<?php

use App\Services\DevForge\Application\ApplicationEnvironmentVariableCatalog;
use ReflectionMethod;

function normalizeEnvValue(?string $value, bool $multiline): array
{
    $method = new ReflectionMethod(ApplicationEnvironmentVariableCatalog::class, 'normalizeStoredValue');
    $method->setAccessible(true);

    return $method->invoke(new ApplicationEnvironmentVariableCatalog, $value, $multiline);
}

test('wrapped tesla base64 body is collapsed to one line for compose safety', function () {
    $wrapped = "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEFGjSUoZnNiZa94HSZWmbEm5J16X6\nTu2YtJ1Aaw3w9S1CQ1lJxH3py2sdvop/FGF00AaeYXr42Oh8lfYDBkuIMA==";

    [$value, $isMultiline] = normalizeEnvValue($wrapped, false);

    expect($isMultiline)->toBeFalse()
        ->and($value)->not->toContain("\n")
        ->and($value)->toContain('FGjSUoZn')
        ->and($value)->toContain('/FGF00Aae');
});

test('pem blocks keep newlines and force multiline', function () {
    $pem = "-----BEGIN PUBLIC KEY-----\nABC\n-----END PUBLIC KEY-----\n";

    [$value, $isMultiline] = normalizeEnvValue($pem, false);

    expect($isMultiline)->toBeTrue()
        ->and($value)->toContain("\n")
        ->and($value)->toContain('BEGIN PUBLIC KEY');
});
