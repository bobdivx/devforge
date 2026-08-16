<?php

namespace App\Services\DevForge\S3;

use Illuminate\Support\Uri;

class S3EndpointNormalizer
{
    /**
     * Convert virtual-hosted S3 URLs (bucket in hostname) to path-style
     * endpoints expected by MinIO client and Laravel's S3 disk.
     *
     * @return array{endpoint: string, bucket: ?string, region: ?string}
     */
    public static function normalize(string $endpoint, ?string $bucket = null, ?string $region = null): array
    {
        $endpoint = trim($endpoint);

        if ($endpoint !== '' && ! str_starts_with($endpoint, 'https://') && ! str_starts_with($endpoint, 'http://')) {
            $endpoint = 'https://'.$endpoint;
        }

        $host = (string) (Uri::of($endpoint)->host() ?? '');

        if (preg_match('/^(.+)\.([^.]+\.digitaloceanspaces\.com)$/', $host, $matches) === 1) {
            $bucket = filled($bucket) ? $bucket : $matches[1];
            $endpoint = 'https://'.$matches[2];
            $host = $matches[2];
        }

        if (preg_match('/^(.+)\.(s3\.([a-z0-9-]+)\.scw\.cloud)$/i', $host, $matches) === 1) {
            $bucket = filled($bucket) ? $bucket : $matches[1];
            $region = strtolower($matches[3]);
            $endpoint = 'https://'.strtolower($matches[2]);
            $host = strtolower($matches[2]);
        }

        if ((! filled($region) || $region === 'us-east-1') && preg_match('/^s3\.([a-z0-9-]+)\.scw\.cloud$/i', $host, $matches) === 1) {
            $region = strtolower($matches[1]);
        }

        return [
            'endpoint' => rtrim($endpoint, '/'),
            'bucket' => $bucket,
            'region' => $region,
        ];
    }
}
