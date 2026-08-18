<?php

namespace App\Services\DevForge;

use App\Models\InstanceSettings;
use App\Services\DevForge\Agent\AgentRuntimeSettings;
use App\Services\DevForge\Sso\SsoProtection;

class InstanceSettingsPresenter
{
    public function __construct(
        private readonly InstanceSettings $settings,
        private readonly AgentRuntimeSettings $agentRuntime = new AgentRuntimeSettings,
        private readonly InstanceUpgradeService $upgradeService = new InstanceUpgradeService,
    ) {}

    public static function from(InstanceSettings $settings): self
    {
        return new self($settings);
    }

    /**
     * @return array<string, mixed>
     */
    public function toArray(): array
    {
        return [
            'instance' => $this->instance(),
            'advanced' => $this->advanced(),
            'email' => $this->email(),
            'updates' => $this->updates(),
            'sso' => $this->ssoPayload(),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function instance(): array
    {
        return [
            'instance_name' => $this->settings->instance_name,
            'fqdn' => $this->settings->fqdn,
            'apps_wildcard_domain' => $this->settings->apps_wildcard_domain,
            'instance_timezone' => $this->settings->instance_timezone,
            'public_ipv4' => $this->settings->public_ipv4,
            'public_ipv6' => $this->settings->public_ipv6,
            'public_port_min' => $this->settings->public_port_min,
            'public_port_max' => $this->settings->public_port_max,
            'helper_version' => $this->settings->helper_version,
            'dev_helper_version' => $this->settings->dev_helper_version,
            'next_channel' => $this->settings->next_channel,
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function advanced(): array
    {
        $agents = $this->agentRuntime->resolved($this->settings);

        return [
            'is_registration_enabled' => (bool) $this->settings->is_registration_enabled,
            'do_not_track' => (bool) $this->settings->do_not_track,
            'is_dns_validation_enabled' => (bool) $this->settings->is_dns_validation_enabled,
            'custom_dns_servers' => $this->settings->custom_dns_servers,
            'is_api_enabled' => (bool) $this->settings->is_api_enabled,
            'allowed_ips' => $this->settings->allowed_ips,
            'is_sponsorship_popup_enabled' => (bool) $this->settings->is_sponsorship_popup_enabled,
            'disable_two_step_confirmation' => (bool) $this->settings->disable_two_step_confirmation,
            'is_wire_navigate_enabled' => (bool) ($this->settings->is_wire_navigate_enabled ?? true),
            'is_mcp_server_enabled' => (bool) $this->settings->is_mcp_server_enabled,
            'agents' => [
                'dynamic_roles_enabled' => $agents['dynamic_roles_enabled'],
                'role_model_routing' => $agents['role_model_routing'],
                'collab_enabled' => $agents['collab_enabled'],
                'code_sandbox_enabled' => $agents['code_sandbox_enabled'],
                'mcp_client_enabled' => $agents['mcp_client_enabled'],
                'mcp_servers' => $agents['mcp_servers'],
            ],
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function email(): array
    {
        return [
            'smtp_enabled' => (bool) $this->settings->smtp_enabled,
            'smtp_from_address' => $this->settings->smtp_from_address,
            'smtp_from_name' => $this->settings->smtp_from_name,
            'smtp_recipients' => $this->settings->smtp_recipients,
            'smtp_host' => $this->settings->smtp_host,
            'smtp_port' => $this->settings->smtp_port,
            'smtp_encryption' => $this->settings->smtp_encryption,
            'smtp_username' => $this->settings->smtp_username,
            'smtp_password_set' => $this->hasSecret($this->settings->getRawOriginal('smtp_password')),
            'smtp_timeout' => $this->settings->smtp_timeout,
            'resend_enabled' => (bool) $this->settings->resend_enabled,
            'resend_api_key_set' => $this->hasSecret($this->settings->getRawOriginal('resend_api_key')),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function updates(): array
    {
        $upgrade = $this->upgradeService->availability($this->settings);

        return [
            'is_auto_update_enabled' => (bool) $this->settings->is_auto_update_enabled,
            'auto_update_frequency' => $this->settings->auto_update_frequency,
            'update_check_frequency' => $this->settings->update_check_frequency,
            'new_version_available' => $upgrade['available'],
            'current_version' => $upgrade['current_version'],
            'latest_version' => $upgrade['latest_version'],
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function ssoPayload(): array
    {
        try {
            return $this->sso();
        } catch (\Throwable $exception) {
            report($exception);

            return [
                'sso_protect_apps_by_default' => true,
                'sso_forward_auth_address' => null,
                'sso_hide_local_login' => false,
                'pocketid_login_enabled' => false,
                'apps_protection_configured' => false,
                'middleware_name' => SsoProtection::MIDDLEWARE_NAME,
                'default_forward_auth_address' => SsoProtection::DEFAULT_FORWARD_AUTH_ADDRESS,
                'managed_by_devforge' => true,
                'can_start' => false,
                'pocket_id_url' => null,
                'oauth2_proxy_url' => null,
            ];
        }
    }

    /**
     * @return array<string, mixed>
     */
    private function sso(): array
    {
        $urls = SsoProtection::publicUrls($this->settings);

        return [
            'sso_protect_apps_by_default' => (bool) $this->settings->sso_protect_apps_by_default,
            'sso_forward_auth_address' => $this->settings->sso_forward_auth_address,
            'sso_hide_local_login' => (bool) $this->settings->sso_hide_local_login,
            'pocketid_login_enabled' => SsoProtection::pocketIdLoginEnabled(),
            'apps_protection_configured' => SsoProtection::isAppsProtectionConfigured($this->settings),
            'middleware_name' => SsoProtection::MIDDLEWARE_NAME,
            'default_forward_auth_address' => SsoProtection::DEFAULT_FORWARD_AUTH_ADDRESS,
            'managed_by_devforge' => true,
            'can_start' => SsoProtection::canStartStack($this->settings),
            'pocket_id_url' => $this->settings->sso_pocket_id_url ?: ($urls['pocket_id'] ?? null),
            'oauth2_proxy_url' => $this->settings->sso_oauth2_proxy_url ?: ($urls['oauth2_proxy'] ?? null),
        ];
    }

    private function hasSecret(mixed $value): bool
    {
        return filled($value);
    }
}
