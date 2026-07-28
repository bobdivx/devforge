<?php

namespace App\Services\DevForge\Agent;

use Illuminate\Support\Facades\Http;

/**
 * Recherche web pour les agents DevForge (DuckDuckGo par défaut, Brave optionnel).
 */
class AgentWebSearchService
{
    /**
     * @return array{ok: bool, query: string, provider: string, results: list<array{title: string, url: string, snippet: string}>, error?: string}
     */
    public function search(string $query, int $limit = 5): array
    {
        $query = trim($query);
        if ($query === '') {
            return ['ok' => false, 'query' => '', 'provider' => 'none', 'results' => [], 'error' => 'query vide'];
        }

        $limit = max(1, min(10, $limit));
        $braveKey = trim((string) config('devforge.agents_web_search_brave_key', ''));

        if ($braveKey !== '') {
            return $this->brave($query, $limit, $braveKey);
        }

        return $this->duckDuckGo($query, $limit);
    }

    /**
     * @return array{ok: bool, query: string, provider: string, results: list<array{title: string, url: string, snippet: string}>, error?: string}
     */
    private function brave(string $query, int $limit, string $apiKey): array
    {
        try {
            $response = Http::withHeaders([
                'Accept' => 'application/json',
                'X-Subscription-Token' => $apiKey,
            ])
                ->timeout(20)
                ->get('https://api.search.brave.com/res/v1/web/search', [
                    'q' => $query,
                    'count' => $limit,
                ]);

            if (! $response->successful()) {
                return [
                    'ok' => false,
                    'query' => $query,
                    'provider' => 'brave',
                    'results' => [],
                    'error' => mb_substr($response->json('message', 'Échec Brave Search'), 0, 300),
                ];
            }

            $web = $response->json('web.results');
            $results = [];
            if (is_array($web)) {
                foreach (array_slice($web, 0, $limit) as $item) {
                    if (! is_array($item)) {
                        continue;
                    }
                    $results[] = [
                        'title' => mb_substr((string) ($item['title'] ?? ''), 0, 200),
                        'url' => (string) ($item['url'] ?? ''),
                        'snippet' => mb_substr((string) ($item['description'] ?? ''), 0, 400),
                    ];
                }
            }

            return ['ok' => true, 'query' => $query, 'provider' => 'brave', 'results' => $results];
        } catch (\Throwable $e) {
            return [
                'ok' => false,
                'query' => $query,
                'provider' => 'brave',
                'results' => [],
                'error' => mb_substr($e->getMessage(), 0, 300),
            ];
        }
    }

    /**
     * @return array{ok: bool, query: string, provider: string, results: list<array{title: string, url: string, snippet: string}>, error?: string}
     */
    private function duckDuckGo(string $query, int $limit): array
    {
        try {
            $response = Http::timeout(20)
                ->acceptJson()
                ->get('https://api.duckduckgo.com/', [
                    'q' => $query,
                    'format' => 'json',
                    'no_html' => 1,
                    'skip_disambig' => 1,
                ]);

            if (! $response->successful()) {
                return [
                    'ok' => false,
                    'query' => $query,
                    'provider' => 'duckduckgo',
                    'results' => [],
                    'error' => 'Échec DuckDuckGo',
                ];
            }

            $json = $response->json();
            $results = [];

            $abstract = trim((string) ($json['AbstractText'] ?? ''));
            $abstractUrl = (string) ($json['AbstractURL'] ?? '');
            if ($abstract !== '') {
                $results[] = [
                    'title' => mb_substr((string) ($json['Heading'] ?? $query), 0, 200),
                    'url' => $abstractUrl,
                    'snippet' => mb_substr($abstract, 0, 400),
                ];
            }

            $related = is_array($json['RelatedTopics'] ?? null) ? $json['RelatedTopics'] : [];
            foreach ($related as $topic) {
                if (count($results) >= $limit) {
                    break;
                }
                if (! is_array($topic)) {
                    continue;
                }
                if (isset($topic['Topics']) && is_array($topic['Topics'])) {
                    foreach ($topic['Topics'] as $nested) {
                        if (count($results) >= $limit || ! is_array($nested)) {
                            continue;
                        }
                        $text = (string) ($nested['Text'] ?? '');
                        $url = (string) ($nested['FirstURL'] ?? '');
                        if ($text === '' || $url === '') {
                            continue;
                        }
                        $results[] = [
                            'title' => mb_substr($text, 0, 120),
                            'url' => $url,
                            'snippet' => mb_substr($text, 0, 400),
                        ];
                    }

                    continue;
                }

                $text = (string) ($topic['Text'] ?? '');
                $url = (string) ($topic['FirstURL'] ?? '');
                if ($text === '' || $url === '') {
                    continue;
                }
                $results[] = [
                    'title' => mb_substr($text, 0, 120),
                    'url' => $url,
                    'snippet' => mb_substr($text, 0, 400),
                ];
            }

            return [
                'ok' => true,
                'query' => $query,
                'provider' => 'duckduckgo',
                'results' => array_slice($results, 0, $limit),
            ];
        } catch (\Throwable $e) {
            return [
                'ok' => false,
                'query' => $query,
                'provider' => 'duckduckgo',
                'results' => [],
                'error' => mb_substr($e->getMessage(), 0, 300),
            ];
        }
    }
}
