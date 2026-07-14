<?php

namespace App\Services\DevForge\Tag;

use App\Models\Tag;
use App\Models\User;
use App\Services\DevForge\Core\CoreResourceAction;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpKernel\Exception\HttpException;

class TagDeployer
{
    public function __construct(
        private CoreResourceAction $resourceAction,
    ) {}

    /**
     * @return array{
     *     tag: string,
     *     results: array<int, array<string, mixed>>,
     *     applications_queued: int,
     *     services_queued: int,
     * }
     */
    public function redeploy(User $user, Tag $tag, bool $force = false): array
    {
        $applications = $tag->applications()->orderBy('name')->get();
        $services = $tag->services()->orderBy('name')->get();

        if ($applications->isEmpty() && $services->isEmpty()) {
            throw ValidationException::withMessages([
                'tag' => ['No resources are associated with this tag.'],
            ]);
        }

        $results = [];
        $applicationsQueued = 0;
        $servicesQueued = 0;

        foreach ($applications as $application) {
            $results[] = $this->deployApplication($user, $application, $force);
            if (($results[array_key_last($results)]['queued'] ?? false) === true) {
                $applicationsQueued++;
            }
        }

        foreach ($services as $service) {
            $results[] = $this->deployService($user, $service);
            if (($results[array_key_last($results)]['queued'] ?? false) === true) {
                $servicesQueued++;
            }
        }

        return [
            'tag' => $tag->name,
            'results' => $results,
            'applications_queued' => $applicationsQueued,
            'services_queued' => $servicesQueued,
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function deployApplication(User $user, $application, bool $force): array
    {
        try {
            Gate::forUser($user)->authorize('deploy', $application);
            $result = $this->resourceAction->execute($application, 'applications', 'deploy', [
                'force' => $force,
            ]);

            return [
                'resource_type' => 'application',
                'uuid' => $application->uuid,
                'name' => $application->name,
                ...$result,
            ];
        } catch (AuthorizationException $exception) {
            return [
                'resource_type' => 'application',
                'uuid' => $application->uuid,
                'name' => $application->name,
                'queued' => false,
                'message' => 'Unauthorized to deploy this application.',
                'error' => $exception->getMessage(),
            ];
        } catch (HttpException $exception) {
            if ($exception->getStatusCode() === 429) {
                throw $exception;
            }

            return [
                'resource_type' => 'application',
                'uuid' => $application->uuid,
                'name' => $application->name,
                'queued' => false,
                'message' => $exception->getMessage(),
            ];
        }
    }

    /**
     * @return array<string, mixed>
     */
    private function deployService(User $user, $service): array
    {
        try {
            Gate::forUser($user)->authorize('deploy', $service);
            $result = $this->resourceAction->execute($service, 'services', 'deploy', []);

            return [
                'resource_type' => 'service',
                'uuid' => $service->uuid,
                'name' => $service->name,
                ...$result,
            ];
        } catch (AuthorizationException $exception) {
            return [
                'resource_type' => 'service',
                'uuid' => $service->uuid,
                'name' => $service->name,
                'queued' => false,
                'message' => 'Unauthorized to deploy this service.',
                'error' => $exception->getMessage(),
            ];
        }
    }
}
