<?php

test('escapeDotEnvValue wraps simple values in double quotes', function () {
    expect(escapeDotEnvValue('simple'))->toBe('"simple"');
});

test('escapeDotEnvValue handles null and empty values', function () {
    expect(escapeDotEnvValue(null))->toBe('""')
        ->and(escapeDotEnvValue(''))->toBe('""');
});

test('escapeDotEnvValue encodes newlines so compose cannot treat them as new keys', function () {
    $value = "Tu2YtJ1Aaw3w9S1CQ1lJxH3py2sdvop/FGF00AaeYXr42Oh8lfYDBkuIMA==\nsecond-line";
    $escaped = escapeDotEnvValue($value);

    expect($escaped)->toBe('"Tu2YtJ1Aaw3w9S1CQ1lJxH3py2sdvop/FGF00AaeYXr42Oh8lfYDBkuIMA==\\nsecond-line"')
        ->and($escaped)->not->toContain("\n");

    $line = 'SECRET='.$escaped;
    expect(explode("\n", $line))->toHaveCount(1);
});

test('escapeDotEnvValue encodes CRLF and preserves slash-heavy base64 on one line', function () {
    $value = "line1\r\nTu2YtJ1Aaw3w9S1CQ1lJxH3py2sdvop/FGF00AaeYXr42Oh8lfYDBkuIMA==";
    $escaped = escapeDotEnvValue($value);

    expect($escaped)->toBe('"line1\\nTu2YtJ1Aaw3w9S1CQ1lJxH3py2sdvop/FGF00AaeYXr42Oh8lfYDBkuIMA=="')
        ->and(substr_count($escaped, "\n"))->toBe(0);
});

test('escapeDotEnvValue escapes backslashes and double quotes', function () {
    expect(escapeDotEnvValue('a\\b"c'))->toBe('"a\\\\b\\"c"');
});

test('escapeDotEnvValue leaves dollar signs for compose interpolation', function () {
    expect(escapeDotEnvValue('$SERVICE_URL_WEB'))->toBe('"$SERVICE_URL_WEB"')
        ->and(escapeDotEnvValue('${SERVICE_FQDN_API}'))->toBe('"${SERVICE_FQDN_API}"');
});

test('runtime env line with multiline secret stays a single dotenv entry', function () {
    $pem = "-----BEGIN PRIVATE KEY-----\nTu2YtJ1Aaw3w9S1CQ1lJxH3py2sdvop/FGF00AaeYXr42Oh8lfYDBkuIMA==\n-----END PRIVATE KEY-----";
    $contents = implode("\n", [
        'HOST='.escapeDotEnvValue('0.0.0.0'),
        'TLS_KEY='.escapeDotEnvValue($pem),
        'PORT='.escapeDotEnvValue('4321'),
    ]);

    $lines = explode("\n", $contents);
    expect($lines)->toHaveCount(3)
        ->and($lines[1])->toStartWith('TLS_KEY="')
        ->and($lines[1])->toEndWith('"')
        ->and($lines[1])->toContain('\\n')
        ->and($lines[1])->not->toMatch('/\nTu2Yt/');
});
