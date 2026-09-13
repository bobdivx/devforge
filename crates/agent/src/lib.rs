mod tools;

use async_trait::async_trait;
use devforge_deploy::DeployFacade;
use devforge_env::EnvFacade;
use devforge_github::GitHubFacade;
use devforge_llm::{
    provider_from_env, AssistantTurn, ChatMessage, ChatRequest, LlmProvider, StubLlmProvider,
};
use devforge_mcp::McpFacade;
use devforge_shared::{DevForgeError, ProjectTestContext, Result, Tool, ToolDefinition};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::Arc;
use tools::{
    CreateGitHubFixTool, CreateGitHubRepoTool, GetDeploymentLogsTool, GetProjectTool,
    GitHubListPrsTool, GitHubWorkflowRunsTool, HttpSmokeTool, ListEnvVarsTool, ListProjectFilesTool,
    ListProjectsTool, McpCallTool, McpListRemoteToolsTool, McpListServersTool, ProposePlanTool,
    PublishToGitHubTool, ReadGitHubFileTool, ReadProjectFileTool, RunApplicationTestsTool,
    StartLocalPreviewTool, SyncWorkdirToGitHubTool, TriggerDeployTool, UpsertEnvVarsTool,
    WriteProjectFileTool,
};
