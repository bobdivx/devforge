<?php

namespace App\Services\DevForge;

use App\Jobs\CheckForUpdatesJob;
use App\Models\InstanceSettings;
use App\Models\OauthSetting;
use App\Models\Server;
use App\Models\ServerSetting;
use App\Rules\ValidDnsServers;
use App\Rules\ValidIpOrCidr;
use App\Services\DevForge\Agent\AgentRuntimeSettings;
use App\Services\DevForge\Application\ApplicationDomainService;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\ValidationException;

class InstanceSettingsUpdater
{
    public function __construct(
        private readonly AgentRuntimeSettings $agentRuntime = new AgentRuntimeSettings,
        private readonly ApplicationDomainService $applicationDomainService = new ApplicationDomainService,
    ) {}

    /**
     * @param  array<string, mixed>  $input
     * @return array<string, mixed>
     */
    public function updateInstance(InstanceSettings $settings, array $input): array
    {
        $validated = validator($input, [
            'fqdn' => ['sometimes', 'nullable', 'string', 'max:255', 'url'],
            'apps_wildcard_domain' => ['sometimes', 'nullable', 'string', 'max:255'],
            'instance_name' => ['sometimes', 'nullable', 'string', 'max:255'],
            'instance_timezone' => ['sometimes', 'required', 'string', 'timezone'],
            'public_ipv4' => ['sometimes', 'nullable', 'ipv4'],
            'public_ipv6' => ['sometimes', 'nullable', 'ipv6'],
            'public_port_min' => ['sometimes', 'required', 'integer', 'min:1025', 'max:65535'],
            'public_port_max' => ['sometimes', 'required', 'integer', 'min:1025', 'max:65535'],
            'dev_helper_version' => ['sometimes', 'nullable', 'string', 'max:128', 'regex:/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/'],
            'force_save_domains' => ['sometimes', 'boolean'],
        ])->validate();

        $wildcardChanged = false;
        $previousWildcard = null;

        if (array_key_exists('instance_timezone', $validated)) {
            $timezone = (string) $validated['instance_timezone'];
            if (function_exists('validate_timezone') && ! validate_timezone($timezone)) {
                throw ValidationException::withMessages([
                    'instance_timezone' => ['Invalid timezone.'],
                ]);
            }
            $settings->instance_timezone = $timezone;
        }

        if (array_key_exists('fqdn', $validated)) {
            $fqdn = $validated['fqdn'];
            $settings->fqdn = filled($fqdn) ? trim((string) $fqdn) : null;
        }

        if (array_key_exists('apps_wildcard_domain', $validated)) {
            $rawWildcard = $validated['apps_wildcard_domain'];
            $normalizedWildcard = filled($rawWildcard)
                ? normalize_apps_wildcard_domain((string) $rawWildcard)
                : null;

            if (filled($rawWildcard) && $normalizedWildcard === null) {
                throw ValidationException::withMessages([
                    'apps_wildcard_domain' => ['Indiquez un domaine valide, par exemple exemple.com'],
                ]);
            }

            $previousWildcard = $settings->apps_wildcard_domain;
            $settings->apps_wildcard_domain = $normalizedWildcard;
            $this->syncAppsWildcardToServers($normalizedWildcard, is_string($previousWildcard) ? $previousWildcard : null);
            $wildcardChanged = $previousWildcard !== $normalizedWildcard;
        }

        foreach (['instance_name', 'public_ipv4', 'public_ipv6', 'dev_helper_version'] as $field) {
            if (array_key_exists($field, $validated)) {
                $value = $validated[$field];
                $settings->{$field} = filled($value) ? (string) $value : null;
            }
        }

        if (array_key_exists('public_port_min', $validated)) {
            $settings->public_port_min = (int) $validated['public_port_min'];
        }

        if (array_key_exists('public_port_max', $validated)) {
            $settings->public_port_max = (int) $validated['public_port_max'];
        }

        if ($settings->public_port_min > $settings->public_port_max) {
            throw ValidationException::withMessages([
                'public_port_min' => ['The minimum port must be lower than the maximum port.'],
            ]);
        }

        if (filled($settings->fqdn) && ! ($validated['force_save_domains'] ?? false)) {
            if (function_exists('checkDomainUsage')) {
                $result = checkDomainUsage(domain: $settings->fqdn);
                if (($result['hasConflicts'] ?? false) === true) {
                    throw ValidationException::withMessages([
                        'fqdn' => ['Domain is already in use. Pass force_save_domains=true to override.'],
                    ]);
                }
            }
        }

        $settings->save();
        $this->refreshLocalhostProxy();

        if ($wildcardChanged && filled($settings->apps_wildcard_domain)) {
            $this->applicationDomainService->regenerateManagedDomains(
                previousWildcard: is_string($previousWildcard) ? $previousWildcard : null,
                redeploy: true,
            );
        }

        return InstanceSettingsPresenter::from($settings->fresh())->toArray();
    }

    /**
     * @param  array<string, mixed>  $input
     * @return array<string, mixed>
     */
    public function updateAdvanced(InstanceSettings $settings, array $input): array
    {
        $validated = validator($input, [
            'is_registration_enabled' => ['sometimes', 'boolean'],
            'do_not_track' => ['sometimes', 'boolean'],
            'is_dns_validation_enabled' => ['sometimes', 'boolean'],
            'custom_dns_servers' => ['sometimes', 'nullable', 'string', new ValidDnsServers],
            'is_api_enabled' => ['sometimes', 'boolean'],
            'allowed_ips' => ['sometimes', 'nullable', 'string', new ValidIpOrCidr],
            'is_sponsorship_popup_enabled' => ['sometimes', 'boolean'],
            'disable_two_step_confirmation' => ['sometimes', 'boolean'],
            'is_wire_navigate_enabled' => ['sometimes', 'boolean'],
            'is_mcp_server_enabled' => ['sometimes', 'boolean'],
            'agents' => ['sometimes', 'array'],
            'agents.dynamic_roles_enabled' => ['sometimes', 'boolean'],
            'agents.role_model_routing' => ['sometimes', 'boolean'],
            'agents.collab_enabled' => ['sometimes', 'boolean'],
            'agents.code_sandbox_enabled' => ['sometimes', 'boolean'],
            'agents.mcp_client_enabled' => ['sometimes', 'boolean'],
            'agents.mcp_servers' => ['sometimes'],
            'confirmation_password' => ['sometimes', 'nullable', 'string'],
        ])->validate();

        $needsPassword = (
            (($validated['is_registration_enabled'] ?? null) === true && ! $settings->is_registration_enabled)
            || (($validated['disable_two_step_confirmation'] ?? null) === true && ! $settings->disable_two_step_confirmation)
        );

        if ($needsPassword) {
            $this->assertConfirmationPassword($validated['confirmation_password'] ?? null);
        }

        if (array_key_exists('custom_dns_servers', $validated)) {
            $settings->custom_dns_servers = $this->normalizeCommaList($validated['custom_dns_servers']);
        }

        if (array_key_exists('allowed_ips', $validated)) {
            $settings->allowed_ips = $this->normalizeAllowedIps($validated['allowed_ips']);
        }

        foreach ([
            'is_registration_enabled',
            'do_not_track',
            'is_dns_validation_enabled',
            'is_api_enabled',
            'is_sponsorship_popup_enabled',
            'disable_two_step_confirmation',
            'is_wire_navigate_enabled',
            'is_mcp_server_enabled',
        ] as $field) {
            if (array_key_exists($field, $validated)) {
                $settings->{$field} = (bool) $validated[$field];
            }
        }

        if (array_key_exists('agents', $validated) && is_array($validated['agents'])) {
            $current = is_array($settings->agents_features) ? $settings->agents_features : [];
            $settings->agents_features = $this->agentRuntime->mergeStored($current, $validated['agents']);
        }

        $settings->save();

        return InstanceSettingsPresenter::from($settings->fresh())->toArray();
    }

    /**
     * @param  array<string, mixed>  $input
     * @return array<string, mixed>
     */
    public function updateEmail(InstanceSettings $settings, array $input): array
    {
        $validated = validator($input, [
            'smtp_enabled' => ['sometimes', 'boolean'],
            'smtp_from_address' => ['sometimes', 'nullable', 'email'],
            'smtp_from_name' => ['sometimes', 'nullable', 'string', 'max:255'],
            'smtp_recipients' => ['sometimes', 'nullable', 'string', 'max:255'],
            'smtp_host' => ['sometimes', 'nullable', 'string', 'max:255'],
            'smtp_port' => ['sometimes', 'nullable', 'integer', 'min:1', 'max:65535'],
            'smtp_encryption' => ['sometimes', 'nullable', 'string', 'in:starttls,tls,none'],
            'smtp_username' => ['sometimes', 'nullable', 'string', 'max:255'],
            'smtp_password' => ['sometimes', 'nullable', 'string'],
            'smtp_timeout' => ['sometimes', 'nullable', 'integer', 'min:1'],
            'resend_enabled' => ['sometimes', 'boolean'],
            'resend_api_key' => ['sometimes', 'nullable', 'string'],
        ])->validate();

        $smtpEnabled = array_key_exists('smtp_enabled', $validated)
            ? (bool) $validated['smtp_enabled']
            : (bool) $settings->smtp_enabled;
        $resendEnabled = array_key_exists('resend_enabled', $validated)
            ? (bool) $validated['resend_enabled']
            : (bool) $settings->resend_enabled;

        if ($smtpEnabled && $resendEnabled) {
            if (array_key_exists('smtp_enabled', $validated) && (bool) $validated['smtp_enabled']) {
                $resendEnabled = false;
            } else {
                $smtpEnabled = false;
            }
        }

        if ($smtpEnabled) {
            $fromAddress = array_key_exists('smtp_from_address', $validated)
                ? $validated['smtp_from_address']
                : $settings->smtp_from_address;
            $fromName = array_key_exists('smtp_from_name', $validated)
                ? $validated['smtp_from_name']
                : $settings->smtp_from_name;
            $host = array_key_exists('smtp_host', $validated)
                ? $validated['smtp_host']
                : $settings->smtp_host;
            $port = array_key_exists('smtp_port', $validated)
                ? $validated['smtp_port']
                : $settings->smtp_port;
            $encryption = array_key_exists('smtp_encryption', $validated)
                ? $validated['smtp_encryption']
                : $settings->smtp_encryption;

            $errors = [];
            if (! filled($fromAddress)) {
                $errors['smtp_from_address'] = ['From address is required when SMTP is enabled.'];
            }
            if (! filled($fromName)) {
                $errors['smtp_from_name'] = ['From name is required when SMTP is enabled.'];
            }
            if (! filled($host)) {
                $errors['smtp_host'] = ['SMTP host is required when SMTP is enabled.'];
            }
            if (! filled($port)) {
                $errors['smtp_port'] = ['SMTP port is required when SMTP is enabled.'];
            }
            if (! filled($encryption)) {
                $errors['smtp_encryption'] = ['SMTP encryption is required when SMTP is enabled.'];
            }
            if ($errors !== []) {
                throw ValidationException::withMessages($errors);
            }
        }

        if ($resendEnabled) {
            $fromAddress = array_key_exists('smtp_from_address', $validated)
                ? $validated['smtp_from_address']
                : $settings->smtp_from_address;
            $fromName = array_key_exists('smtp_from_name', $validated)
                ? $validated['smtp_from_name']
                : $settings->smtp_from_name;
            $apiKey = array_key_exists('resend_api_key', $validated) && $this->isProvidedSecret($validated['resend_api_key'] ?? null)
                ? $validated['resend_api_key']
                : $settings->resend_api_key;

            $errors = [];
            if (! filled($fromAddress)) {
                $errors['smtp_from_address'] = ['From address is required when Resend is enabled.'];
            }
            if (! filled($fromName)) {
                $errors['smtp_from_name'] = ['From name is required when Resend is enabled.'];
            }
            if (! filled($apiKey)) {
                $errors['resend_api_key'] = ['Resend API key is required when Resend is enabled.'];
            }
            if ($errors !== []) {
                throw ValidationException::withMessages($errors);
            }
        }

        $settings->smtp_enabled = $smtpEnabled;
        $settings->resend_enabled = $resendEnabled;

        foreach ([
            'smtp_from_address',
            'smtp_from_name',
            'smtp_recipients',
            'smtp_host',
            'smtp_encryption',
            'smtp_username',
        ] as $field) {
            if (array_key_exists($field, $validated)) {
                $value = $validated[$field];
                $settings->{$field} = filled($value) ? (string) $value : null;
            }
        }

        foreach (['smtp_port', 'smtp_timeout'] as $field) {
            if (array_key_exists($field, $validated)) {
                $settings->{$field} = $validated[$field];
            }
        }

        if (array_key_exists('smtp_password', $validated) && $this->isProvidedSecret($validated['smtp_password'])) {
            $settings->smtp_password = (string) $validated['smtp_password'];
        }

        if (array_key_exists('resend_api_key', $validated) && $this->isProvidedSecret($validated['resend_api_key'])) {
            $settings->resend_api_key = (string) $validated['resend_api_key'];
        }

        $settings->save();

        return InstanceSettingsPresenter::from($settings->fresh())->toArray();
    }

    /**
     * @param  array<string, mixed>  $input
     * @return array<string, mixed>
     */
    public function updateUpdates(InstanceSettings $settings, array $input): array
    {
        $validated = validator($input, [
            'is_auto_update_enabled' => ['sometimes', 'boolean'],
            'auto_update_frequency' => ['sometimes', 'nullable', 'string', 'max:255'],
            'update_check_frequency' => ['sometimes', 'nullable', 'string', 'max:255'],
        ])->validate();

        if (array_key_exists('is_auto_update_enabled', $validated)) {
            $settings->is_auto_update_enabled = (bool) $validated['is_auto_update_enabled'];
        }

        if (array_key_exists('auto_update_frequency', $validated)) {
            $frequency = (string) ($validated['auto_update_frequency'] ?? '');
            if ($settings->is_auto_update_enabled && function_exists('validate_cron_expression') && ! validate_cron_expression($frequency)) {
                throw ValidationException::withMessages([
                    'auto_update_frequency' => ['Invalid Cron / Human expression for Auto Update Frequency.'],
                ]);
            }
            $settings->auto_update_frequency = $frequency !== '' ? $frequency : '0 0 * * *';
        }

        if (array_key_exists('update_check_frequency', $validated)) {
            $frequency = (string) ($validated['update_check_frequency'] ?? '');
            if ($frequency === '' || (function_exists('validate_cron_expression') && ! validate_cron_expression($frequency))) {
                throw ValidationException::withMessages([
                    'update_check_frequency' => ['Invalid Cron / Human expression for Update Check Frequency.'],
                ]);
            }
            $settings->update_check_frequency = $frequency;
        }

        $settings->save();
        $this->refreshLocalhostProxy();

        return InstanceSettingsPresenter::from($settings->fresh())->toArray();
    }

    /**
     * @return array<string, mixed>
     */
    public function checkForUpdates(InstanceSettings $settings): array
    {
        CheckForUpdatesJob::dispatchSync();

        return InstanceSettingsPresenter::from($settings->fresh())->toArray();
    }

    /**
     * @param  array<string, mixed>  $input
     * @return array<string, mixed>
     */
    public function updateOauth(OauthSetting $oauth, array $input): array
    {
        $validated = validator($input, [
            'enabled' => ['sometimes', 'boolean'],
            'client_id' => ['sometimes', 'nullable', 'string', 'max:255'],
            'client_secret' => ['sometimes', 'nullable', 'string'],
            'redirect_uri' => ['sometimes', 'nullable', 'string', 'max:255'],
            'tenant' => ['sometimes', 'nullable', 'string', 'max:255'],
            'base_url' => ['sometimes', 'nullable', 'string', 'max:255'],
        ])->validate();

        if (array_key_exists('client_id', $validated) && $this->isProvidedSecret($validated['client_id'])) {
            $oauth->client_id = (string) $validated['client_id'];
        }

        if (array_key_exists('client_secret', $validated) && $this->isProvidedSecret($validated['client_secret'])) {
            $oauth->client_secret = (string) $validated['client_secret'];
        }

        foreach (['redirect_uri', 'tenant', 'base_url'] as $field) {
            if (array_key_exists($field, $validated)) {
                $value = $validated[$field];
                $oauth->{$field} = filled($value) ? (string) $value : null;
            }
        }

        $wantEnabled = array_key_exists('enabled', $validated)
            ? (bool) $validated['enabled']
            : (bool) $oauth->enabled;

        if ($wantEnabled && ! $oauth->couldBeEnabled()) {
            throw ValidationException::withMessages([
                'enabled' => ['OAuth settings are incomplete for '.$oauth->provider.'. Fill all required fields.'],
            ]);
        }

        $oauth->enabled = $wantEnabled && $oauth->couldBeEnabled();
        $oauth->save();

        return $this->presentOauth($oauth->fresh());
    }

    /**
     * @return array<string, mixed>
     */
    public function presentOauth(OauthSetting $oauth): array
    {
        return [
            'id' => $oauth->id,
            'provider' => $oauth->provider,
            'enabled' => (bool) $oauth->enabled,
            'client_id' => filled($oauth->client_id) ? (string) $oauth->client_id : null,
            'client_secret_set' => filled($oauth->client_secret),
            'redirect_uri' => $oauth->redirect_uri,
            'tenant' => $oauth->tenant,
            'base_url' => $oauth->base_url,
        ];
    }

    private function assertConfirmationPassword(?string $password): void
    {
        if (function_exists('shouldSkipPasswordConfirmation') && shouldSkipPasswordConfirmation()) {
            return;
        }

        $user = Auth::user();
        if ($user === null || ! is_string($password) || ! Hash::check($password, $user->password)) {
            throw ValidationException::withMessages([
                'confirmation_password' => ['The provided password is incorrect.'],
            ]);
        }
    }

    private function isProvidedSecret(mixed $value): bool
    {
        return is_string($value) && trim($value) !== '' && $value !== '********';
    }

    private function normalizeCommaList(mixed $value): ?string
    {
        if (! filled($value)) {
            return null;
        }

        return str((string) $value)
            ->replaceEnd(',', '')
            ->trim()
            ->explode(',')
            ->map(fn ($item) => str($item)->trim()->lower()->toString())
            ->filter()
            ->unique()
            ->implode(',');
    }

    private function normalizeAllowedIps(mixed $value): ?string
    {
        if (! filled($value)) {
            return null;
        }

        $raw = str((string) $value)->replaceEnd(',', '')->trim()->toString();
        if ($raw === '' || in_array('0.0.0.0', array_map('trim', explode(',', $raw)), true)) {
            return $raw === '' ? null : $raw;
        }

        $entries = collect(explode(',', $raw))
            ->map(fn ($entry) => trim($entry))
            ->filter()
            ->values()
            ->all();

        if (function_exists('deduplicateAllowlist')) {
            $entries = deduplicateAllowlist($entries);
        }

        return implode(',', $entries);
    }

    private function syncAppsWildcardToServers(?string $wildcard, ?string $previousWildcard): void
    {
        if (! filled($wildcard)) {
            return;
        }

        $normalized = rtrim($wildcard, '/');

        ServerSetting::query()
            ->where(function ($query) use ($previousWildcard): void {
                $query->whereNull('wildcard_domain')
                    ->orWhere('wildcard_domain', '')
                    ->orWhere('wildcard_domain', 'like', '%sslip.io%')
                    ->orWhere('server_id', 0);

                if (filled($previousWildcard)) {
                    $query->orWhere('wildcard_domain', rtrim((string) $previousWildcard, '/'));
                }
            })
            ->update(['wildcard_domain' => $normalized]);
    }

    private function refreshLocalhostProxy(): void
    {
        if (function_exists('isCloud') && isCloud()) {
            return;
        }

        $server = Server::find(0);
        if ($server) {
            $server->setupDynamicProxyConfiguration();
        }
    }
}
