<?php

namespace App\Services\DevForge\Agent\Tool;

use App\Models\AiAgent;
use App\Services\DevForge\Agent\AgentRuntimeSettings;

/**
 * État des paquets et outils custom pour un run agent.
 */
class AgentToolkitSession
{
    /** @var string[] */
    private array $enabledPackages;

    /** @var array<int, array<string, mixed>> */
    private array $customTools;

    /**
     * @param  list<string>  $extraPackages
     */
    public function __construct(
        private readonly ?AiAgent $agent = null,
        array $extraPackages = [],
    ) {
        $metadata = is_array($this->agent?->metadata) ? $this->agent->metadata : [];
        $toolState = is_array($metadata['tool_packages'] ?? null) ? $metadata['tool_packages'] : [];

        $persisted = array_values(array_filter(
            array_map('strval', is_array($toolState['enabled'] ?? null) ? $toolState['enabled'] : []),
            fn (string $id): bool => AgentToolPackage::exists($id),
        ));

        $typeDefaults = $this->agent
            ? AgentToolPackage::defaultForAgentType($this->agent->type)
            : [AgentToolPackage::PACKAGE_CORE];

        $extras = array_values(array_filter(
            array_map('strval', $extraPackages),
            fn (string $id): bool => AgentToolPackage::exists($id),
        ));

        $this->enabledPackages = array_values(array_unique([
            AgentToolPackage::PACKAGE_CORE,
            ...$typeDefaults,
            ...$persisted,
            ...$extras,
        ]));

        $this->customTools = is_array($toolState['custom_tools'] ?? null) ? $toolState['custom_tools'] : [];
    }

    /** @return string[] */
    public function enabledPackages(): array
    {
        return $this->enabledPackages;
    }

    /** @return array<int, array<string, mixed>> */
    public function customTools(): array
    {
        return $this->customTools;
    }

    public function isPackageEnabled(string $packageId): bool
    {
        return in_array($packageId, $this->enabledPackages, true);
    }

    public function isToolEnabled(string $toolName): bool
    {
        if (in_array($toolName, AgentToolPackage::META_TOOLS, true)) {
            if (in_array($toolName, ['mcp_list_servers', 'mcp_list_remote_tools'], true)) {
                return app(AgentRuntimeSettings::class)->mcpClientEnabled();
            }

            return true;
        }

        if (str_starts_with($toolName, 'mcp__')
            && app(AgentRuntimeSettings::class)->mcpClientEnabled()) {
            return true;
        }

        foreach ($this->customTools as $customTool) {
            if (($customTool['name'] ?? '') === $toolName) {
                return true;
            }
        }

        foreach ($this->enabledPackages as $packageId) {
            if (in_array($toolName, AgentToolPackage::toolNames($packageId), true)) {
                return true;
            }
        }

        return false;
    }

    public function enablePackage(string $packageId): bool
    {
        if (! AgentToolPackage::exists($packageId) || $this->isPackageEnabled($packageId)) {
            return false;
        }

        $this->enabledPackages[] = $packageId;

        return true;
    }

    /**
     * @param  array<string, mixed>  $tool
     */
    public function registerCustomTool(array $tool): void
    {
        $name = (string) ($tool['name'] ?? '');
        if ($name === '') {
            return;
        }

        $this->customTools = array_values(array_filter(
            $this->customTools,
            fn (array $existing): bool => ($existing['name'] ?? '') !== $name,
        ));

        $this->customTools[] = $tool;
    }

    public function persistToAgent(): void
    {
        if ($this->agent === null) {
            return;
        }

        $metadata = is_array($this->agent->metadata) ? $this->agent->metadata : [];
        $persistedPackages = array_values(array_filter(
            $this->enabledPackages,
            fn (string $id): bool => $id !== AgentToolPackage::PACKAGE_CORE,
        ));

        $metadata['tool_packages'] = [
            'enabled' => $persistedPackages,
            'custom_tools' => $this->customTools,
        ];

        $this->agent->metadata = $metadata;
        $this->agent->saveQuietly();
    }
}
