<?php

namespace App\Services\DevForge\S3;

use App\Models\S3Storage;
use App\Models\Team;
use App\Models\User;
use App\Rules\SafeWebhookUrl;
use App\Services\DevForge\CurrentTeamContext;
use App\Support\ValidationPatterns;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Uri;
use Illuminate\Validation\ValidationException;

class S3StorageService
{
    public function __construct(
        private readonly CurrentTeamContext $currentTeamContext,
        private readonly S3StoragePresenter $presenter,
    ) {}

    /**
     * @return array<int, array<string, mixed>>
     */
    public function list(User $user): array
    {
        $team = $this->currentTeamContext->resolve($user);

        return S3Storage::ownedByCurrentTeamAPI($team->id)
            ->get()
            ->map(fn (S3Storage $storage): array => $this->presenter->present($storage))
            ->all();
    }

    /**
     * @param  array<string, mixed>  $input
     * @return array<string, mixed>
     */
    public function create(User $user, array $input): array
    {
        $team = $this->currentTeamContext->resolve($user);
        $validated = $this->validateInput($input, creating: true);

        $storage = new S3Storage;
        $storage->team_id = $team->id;
        $this->fillStorage($storage, $validated);
        $storage->is_usable = false;
        $storage->save();

        auditLog('devforge.s3_storage.created', [
            'team_id' => $team->id,
            'storage_uuid' => $storage->uuid,
        ]);

        return $this->presenter->present($storage);
    }

    /**
     * @param  array<string, mixed>  $input
     * @return array<string, mixed>
     */
    public function update(User $user, string $storageUuid, array $input): array
    {
        $team = $this->currentTeamContext->resolve($user);
        $storage = $this->findForTeam($team, $storageUuid);
        $validated = $this->validateInput($input, creating: false);

        $this->fillStorage($storage, $validated);
        $storage->save();

        auditLog('devforge.s3_storage.updated', [
            'team_id' => $team->id,
            'storage_uuid' => $storage->uuid,
        ]);

        return $this->presenter->present($storage->fresh());
    }

    public function delete(User $user, string $storageUuid): void
    {
        $team = $this->currentTeamContext->resolve($user);
        $storage = $this->findForTeam($team, $storageUuid);

        auditLog('devforge.s3_storage.deleted', [
            'team_id' => $team->id,
            'storage_uuid' => $storage->uuid,
        ]);

        $storage->delete();
    }

    /**
     * @return array<string, mixed>
     */
    public function test(User $user, string $storageUuid): array
    {
        $team = $this->currentTeamContext->resolve($user);
        $storage = $this->findForTeam($team, $storageUuid);

        $storage->testConnection(shouldSave: true);

        return [
            'success' => true,
            'message' => 'Connexion S3 validée.',
            'storage' => $this->presenter->present($storage->fresh()),
        ];
    }

    public function findForTeam(Team $team, string $storageUuid): S3Storage
    {
        return S3Storage::ownedByCurrentTeamAPI($team->id)
            ->where('uuid', $storageUuid)
            ->firstOrFail();
    }

    /**
     * @param  array<string, mixed>  $input
     * @return array<string, mixed>
     */
    private function validateInput(array $input, bool $creating): array
    {
        $rules = [
            'name' => ValidationPatterns::nameRules(required: $creating),
            'description' => ValidationPatterns::descriptionRules(),
            'region' => ['required', 'max:255'],
            'key' => [$creating ? 'required' : 'sometimes', 'max:255'],
            'secret' => [$creating ? 'required' : 'sometimes', 'max:255'],
            'bucket' => ['required', 'max:255'],
            'endpoint' => ['required', 'max:255', new SafeWebhookUrl],
        ];

        $validator = Validator::make($input, $rules, ValidationPatterns::combinedMessages());

        if ($validator->fails()) {
            throw ValidationException::withMessages($validator->errors()->toArray());
        }

        /** @var array<string, mixed> $validated */
        $validated = $validator->validated();

        if (! empty($validated['endpoint'])) {
            $validated['endpoint'] = $this->normalizeEndpoint((string) $validated['endpoint']);
        }

        return $validated;
    }

    /**
     * @param  array<string, mixed>  $validated
     */
    private function fillStorage(S3Storage $storage, array $validated): void
    {
        if (array_key_exists('name', $validated)) {
            $storage->name = $validated['name'];
        }
        if (array_key_exists('description', $validated)) {
            $storage->description = $validated['description'];
        }
        if (array_key_exists('region', $validated)) {
            $storage->region = $validated['region'];
        }
        if (array_key_exists('key', $validated)) {
            $storage->key = $validated['key'];
        }
        if (array_key_exists('secret', $validated)) {
            $storage->secret = $validated['secret'];
        }
        if (array_key_exists('bucket', $validated)) {
            $storage->bucket = $validated['bucket'];
        }
        if (array_key_exists('endpoint', $validated)) {
            $storage->endpoint = $validated['endpoint'];
        } elseif (! $storage->exists && ! empty($validated['region'])) {
            $storage->endpoint = 'https://s3.'.$validated['region'].'.amazonaws.com';
        }
    }

    private function normalizeEndpoint(string $endpoint): string
    {
        if (str($endpoint)->contains('digitaloceanspaces.com')) {
            $uri = Uri::of($endpoint);
            $host = $uri->host();

            if (preg_match('/^(.+)\.([^.]+\.digitaloceanspaces\.com)$/', $host, $matches)) {
                $host = $matches[2];
                $endpoint = "https://{$host}";
            }
        }

        if (! str($endpoint)->startsWith('https://') && ! str($endpoint)->startsWith('http://')) {
            $endpoint = 'https://'.$endpoint;
        }

        return $endpoint;
    }

}
