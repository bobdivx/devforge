<?php

// To prevent github actions from failing
function env()
{
    return null;
}

$version = include __DIR__.'/../config/constants.php';

if (! is_array($version)) {
    echo 'unknown';
    exit(0);
}

echo $version['coolify']['version'] ?: 'unknown';
