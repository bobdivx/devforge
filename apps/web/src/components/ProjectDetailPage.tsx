import { useEffect, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { api, type AppGroupMember, type ClusterNode, type Deployment, type InstanceDomain, type Project, type ProjectRuntime, type PublishedPort } from '../lib/api';
import { nodeShortLabel, resolveNode } from '../lib/cluster-display';
import { cn } from '../lib/cn';
import { partitionEnvRows } from '../lib/env-groups';
import { projectNavMore, projectNavPrimary } from '../lib/nav';
import { projectStatusMeta, projectSyncMeta } from '../lib/status';
import { AppIcon, statusDotClass } from './AppIcon';
import { AppShell } from './AppShell';
import { ModelSentence } from './ModelSentence';
import { ProjectAgentsHub } from './ProjectAgentsHub';
import { ProjectHome } from './ProjectHome';
import { StatusBadge } from './StatusBadge';
import { DeployLogSheet } from './DeployLogSheet';
import { ProjectSpecsModal } from './ProjectSpecsModal';
import { ProjectActionsPanel } from './ProjectActionsPanel';
import { ProjectGitPanel } from './ProjectGitPanel';
import { ProjectOidcPanel } from './ProjectOidcPanel';
import { ProjectGroupPanel, ProjectGroupSuggest } from './GroupPage';
import { ProjectWorkspace } from './ProjectWorkspace';
import { ProjectRulesModal } from './workspace/ProjectRulesModal';
import { NodeSelect } from './NodeSelect';
import {
  ChevronDown,
  ChevronRight,
  Copy,
  ExternalLink,
  FileCode,
  HeartPulse,
  Rocket,
  RotateCw,
  Square,
} from 'lucide-preact';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  FadeIn,
  HubAddTile,
  HubGrid,
  HubIcon,
  HubTile,
  Input,
  LiveStatus,
  Modal,
  Spinner,
  Table,
  Td,
  Tr,
  useToast,
} from './ui';

type Tab =
  | 'home'
  | 'overview'
  | 'workspace'
  | 'deployments'
  | 'git'
  | 'actions'
  | 'agents'
  | 'domains'
  | 'database'
  | 'env'
  | 'backups'
  | 'crons'
  | 'settings';

type Props = { uuid?: string; tab?: Tab };

function readQuery(): { uuid: string; tab: Tab; builder?: boolean; agent?: string; spec?: string } {
  if (typeof window === 'undefined') {
    return { uuid: '', tab: 'overview' };
  }
  const q = new URLSearchParams(window.location.search);
  // Sans ?tab : Tableau de bord (Overview). Les anciens ?tab= restent valides.
  const tab = (q.get('tab') as Tab) || 'overview';
  const allowed: Tab[] = [
    'home',
    'overview',
    'workspace',
    'deployments',
    'git',
    'actions',
    'agents',
    'domains',
    'database',
    'env',
    'backups',
    'crons',
    'settings',
  ];
  return {
    uuid: q.get('uuid') || '',
    tab: allowed.includes(tab) ? tab : 'overview',
    builder: q.get('builder') === '1',
    agent: q.get('agent') || undefined,
    spec: q.get('spec') || undefined,
  };
}
