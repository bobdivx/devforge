<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Symfony\Component\HttpFoundation\BinaryFileResponse;

class DevForgeController extends Controller
{
    public function __invoke(Request $request, ?string $path = null): BinaryFileResponse|Response
    {
        abort_unless(config('devforge.enabled'), 404);

        $basePath = realpath(public_path('devforge'));

        if ($basePath === false) {
            return $this->missingAssetsResponse();
        }

        $relativePath = $path !== null && $path !== '' ? $path : 'index.html';
        $candidate = realpath($basePath.DIRECTORY_SEPARATOR.str_replace(['/', '\\'], DIRECTORY_SEPARATOR, $relativePath));

        if ($candidate !== false && str_starts_with($candidate, $basePath) && is_file($candidate)) {
            return response()->file($candidate, $this->headersFor($candidate));
        }

        $indexPath = $basePath.DIRECTORY_SEPARATOR.'index.html';

        if (! is_file($indexPath)) {
            return $this->missingAssetsResponse();
        }

        return response()->file($indexPath, [
            'Cache-Control' => 'no-store, private',
            'Content-Type' => 'text/html; charset=UTF-8',
        ]);
    }

    private function missingAssetsResponse(): Response
    {
        return response(
            'DevForge assets are unavailable. Run the DevForge frontend build.',
            503,
            ['Content-Type' => 'text/plain; charset=UTF-8'],
        );
    }

    /**
     * @return array<string, string>
     */
    private function headersFor(string $path): array
    {
        $extension = strtolower(pathinfo($path, PATHINFO_EXTENSION));

        $cacheControl = in_array($extension, ['js', 'css', 'woff', 'woff2', 'png', 'svg', 'webp', 'ico'], true)
            ? 'public, max-age=31536000, immutable'
            : 'no-store, private';

        return ['Cache-Control' => $cacheControl];
    }
}
