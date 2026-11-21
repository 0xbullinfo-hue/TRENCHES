'use client';

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import type {
  AlphaCategory,
  AlphaItem,
  Campaign,
  Chain,
  PublicationStatus,
  PublishingDestination,
} from '@/lib/types';
import type { CreateCallPayload } from '@/context/GenesisContext';
import { Button } from '@/components/ui/Button';
import { AlphaCallCard } from '@/components/dashboard/AlphaCallCard';
import { AdminCampaignManager } from './AdminCampaignManager';
import {
  AlertTriangle,
  Archive,
  ArrowUpRight,
  BookOpen,
  Check,
  CheckCircle2,
  Eye,
  FileEdit,
  FileText,
  Flame,
  Layers,
  Pencil,
  Pin,
  Plus,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  Target,
  Trash2,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';

type AdminSubTab = 'CONTENT' | 'EDITOR' | 'CAMPAIGNS';
type ContentStatusFilter = 'ALL' | PublicationStatus;
type DestinationFilter = 'ALL' | 'ALPHA' | 'MAX_ALPHA' | 'DUAL';

const CHAINS: Chain[] = ['SOL', 'BSC', 'ETH', 'BASE', 'ROBIN', 'AVAX'];
const CATEGORIES: AlphaCategory[] = ['NEW', 'MOVERS', 'AI_AGENT', 'HOLDER_REWARDS', 'STEALTH', 'CHARITY'];

interface AdminWorkspaceProps {
  items: AlphaItem[];
  campaigns: Campaign[];
  adminActionError?: string | null;
  onCreateCall: (payload: CreateCallPayload) => Promise<boolean>;
  onUpdateCall: (id: string, updates: Record<string, unknown>) => Promise<boolean>;
  onDeleteCall: (id: string) => Promise<boolean>;
  onTogglePin: (id: string, nextPinned: boolean) => Promise<boolean>;
  onSetOutcome: (id: string, outcome: 'PROFIT' | 'LOSS' | 'PENDING') => Promise<boolean>;
  onInspect: (item: AlphaItem) => void;
  onToast: (msg: string, type?: 'success' | 'error') => void;
  getAdminHeaders?: (method: string, path: string, body: string) => Promise<Record<string, string>>;
}

function getItemDestinations(item: AlphaItem): PublishingDestination[] {
  if (Array.isArray(item.destinations) && item.destinations.length > 0) {
    return item.destinations;
  }
  if (item.callType === 'MAX_ALPHA' || item.isMaxAlpha) return ['MAX_ALPHA'];
  if (item.callType === 'ALPHA') return ['ALPHA'];
  return [];
}

function getItemPublishStatus(item: AlphaItem): PublicationStatus {
  if (item.publishStatus === 'DRAFT' || item.publishStatus === 'ARCHIVED') {
    return item.publishStatus;
  }
  return 'PUBLISHED';
}

export const AdminWorkspace: React.FC<AdminWorkspaceProps> = ({
  items,
  campaigns,
  adminActionError,
  onCreateCall,
  onUpdateCall,
  onDeleteCall,
  onTogglePin,
  onSetOutcome,
  onInspect,
  onToast,
  getAdminHeaders,
}) => {
  const [subTab, setSubTab] = useState<AdminSubTab>('CONTENT');
  const [statusFilter, setStatusFilter] = useState<ContentStatusFilter>('PUBLISHED');
  const [destFilter, setDestFilter] = useState<DestinationFilter>('ALL');
  const [chainFilter, setChainFilter] = useState<Chain | 'ALL'>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [busyRowId, setBusyRowId] = useState<string | null>(null);

  // Editor form state
  const [editingCall, setEditingCall] = useState<AlphaItem | null>(null);
  const [formCa, setFormCa] = useState('');
  const [formName, setFormName] = useState('');
  const [formTicker, setFormTicker] = useState('');
  const [formLogoUrl, setFormLogoUrl] = useState('');
  const [formChain, setFormChain] = useState<Chain>('SOL');
  const [formCategory, setFormCategory] = useState<AlphaCategory>('NEW');
  const [formCaller, setFormCaller] = useState('@TrenchLabsAdmin');
  const [formCurrentMc, setFormCurrentMc] = useState('$250K');
  const [formEntryMc, setFormEntryMc] = useState('$250K');
  const [formRiskLevel, setFormRiskLevel] = useState<number>(3);
  const [formStopLoss, setFormStopLoss] = useState('-25% SL');
  const [formTakeProfits, setFormTakeProfits] = useState('2x, 5x, 10x');
  const [formPinned, setFormPinned] = useState(true);
  const [formDestinations, setFormDestinations] = useState<PublishingDestination[]>(['ALPHA']);
  const [formSummary, setFormSummary] = useState('');
  const [formSerialTag, setFormSerialTag] = useState('');
  const [fetchingDex, setFetchingDex] = useState(false);
  const [submittingMode, setSubmittingMode] = useState<'DRAFT' | 'PUBLISHED' | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

  const nextSerialTag = `EXP${String(items.length + 1).padStart(2, '0')}`;

  // Counts for Overview KPIs & status filter tabs
  const counts = useMemo(() => {
    let published = 0;
    let drafts = 0;
    let archived = 0;
    let alphaDest = 0;
    let maxAlphaDest = 0;
    let dualDest = 0;
    for (const item of items) {
      const ps = getItemPublishStatus(item);
      if (ps === 'DRAFT') drafts += 1;
      else if (ps === 'ARCHIVED') archived += 1;
      else published += 1;

      const dests = getItemDestinations(item);
      const hasAlpha = dests.includes('ALPHA');
      const hasMax = dests.includes('MAX_ALPHA');
      if (hasAlpha && hasMax) dualDest += 1;
      else if (hasMax) maxAlphaDest += 1;
      else if (hasAlpha) alphaDest += 1;
    }
    return {
      total: items.length,
      published,
      drafts,
      archived,
      alphaDest,
      maxAlphaDest,
      dualDest,
      activeRaids: campaigns.filter((c) => c.status === 'ACTIVE').length,
    };
  }, [items, campaigns]);

  const filteredItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return items.filter((item) => {
      const ps = getItemPublishStatus(item);
      if (statusFilter !== 'ALL' && ps !== statusFilter) return false;
      if (chainFilter !== 'ALL' && item.chain !== chainFilter) return false;

      const dests = getItemDestinations(item);
      const hasAlpha = dests.includes('ALPHA');
      const hasMax = dests.includes('MAX_ALPHA');
      if (destFilter === 'ALPHA' && !hasAlpha) return false;
      if (destFilter === 'MAX_ALPHA' && !hasMax) return false;
      if (destFilter === 'DUAL' && !(hasAlpha && hasMax)) return false;

      if (q) {
        const hit =
          item.name.toLowerCase().includes(q) ||
          item.ticker.toLowerCase().includes(q) ||
          (item.ca?.toLowerCase().includes(q) ?? false) ||
          item.caller.toLowerCase().includes(q) ||
          (item.serialTag?.toLowerCase().includes(q) ?? false);
        if (!hit) return false;
      }
      return true;
    });
  }, [items, statusFilter, chainFilter, destFilter, searchQuery]);

  const toggleDestination = (dest: PublishingDestination) => {
    setFormDestinations((prev) => {
      if (prev.includes(dest)) {
        // Require at least one destination selected
        if (prev.length === 1) return prev;
        return prev.filter((d) => d !== dest);
      }
      return [...prev, dest];
    });
  };

  const resetForm = () => {
    setEditingCall(null);
    setFormCa('');
    setFormLogoUrl('');
    setFormName('');
    setFormTicker('');
    setFormChain('SOL');
    setFormCategory('NEW');
    setFormCaller('@TrenchLabsAdmin');
    setFormCurrentMc('$250K');
    setFormEntryMc('$250K');
    setFormRiskLevel(3);
    setFormStopLoss('-25% SL');
    setFormTakeProfits('2x, 5x, 10x');
    setFormPinned(true);
    setFormDestinations(['ALPHA']);
    setFormSummary('');
    setFormSerialTag('');
    setValidationError(null);
  };

  const handleOpenNewEditor = () => {
    resetForm();
    setSubTab('EDITOR');
  };

  const handleStartEdit = (call: AlphaItem) => {
    setEditingCall(call);
    setFormCa(call.ca || '');
    setFormName(call.name);
    setFormTicker(call.ticker);
    setFormLogoUrl(call.logoUrl || '');
    setFormChain(call.chain);
    setFormCategory(call.category || 'NEW');
    setFormCaller(call.caller || '@TrenchLabsAdmin');
    setFormCurrentMc(call.marketCap && call.marketCap !== '—' ? call.marketCap : '$250K');
    setFormEntryMc(call.entryMarketCap && call.entryMarketCap !== '—' ? call.entryMarketCap : '$250K');
    setFormRiskLevel(call.risk || 3);
    setFormStopLoss(call.stopLoss || '-25% SL');
    setFormTakeProfits(
      call.takeProfits && call.takeProfits.length > 0
        ? call.takeProfits.map((tp) => `${tp.multiple}x`).join(', ')
        : '2x, 5x, 10x'
    );
    setFormPinned(Boolean(call.pinned));
    const dests = getItemDestinations(call);
    setFormDestinations(dests.length > 0 ? dests : ['ALPHA']);
    setFormSummary(call.summary || '');
    setFormSerialTag(call.serialTag || '');
    setValidationError(null);
    setSubTab('EDITOR');
    onToast(`Loaded ${call.ticker} into editor`);
  };

  const handleAutoFillDexScreener = async () => {
    const cleanCa = formCa.trim();
    if (!cleanCa) {
      setValidationError('Paste a Contract Address (CA) first to auto-fill.');
      return;
    }
    setValidationError(null);
    setFetchingDex(true);
    try {
      const res = await fetch(
        `https://api.dexscreener.com/latest/dex/tokens/${encodeURIComponent(cleanCa)}`
      );
      if (!res.ok) {
        onToast(
          res.status === 429
            ? 'DexScreener rate limit reached. Try again shortly.'
            : 'Could not fetch live DexScreener telemetry. Enter fields manually.',
          'error'
        );
        return;
      }
      const data = await res.json();
      const pair = data?.pairs?.[0];
      if (!pair) {
        onToast('No active DEX pair found for this contract address.', 'error');
        return;
      }
      if (pair.baseToken?.name) setFormName(pair.baseToken.name);
      if (pair.baseToken?.symbol) setFormTicker(`$${pair.baseToken.symbol}`);
      if (pair.info?.imageUrl) setFormLogoUrl(pair.info.imageUrl);
      const chainId = String(pair.chainId || '').toLowerCase();
      if (chainId.includes('sol')) setFormChain('SOL');
      else if (chainId.includes('bsc')) setFormChain('BSC');
      else if (chainId.includes('eth')) setFormChain('ETH');
      else if (chainId.includes('base')) setFormChain('BASE');
      else if (chainId.includes('avax') || chainId.includes('avalanche')) setFormChain('AVAX');
      else if (chainId.includes('robin')) setFormChain('ROBIN');

      const mc = Number(pair.marketCap || pair.fdv || 0);
      if (mc > 0) {
        const formatted =
          mc >= 1_000_000
            ? `$${(mc / 1_000_000).toFixed(2)}M`
            : `$${(mc / 1_000).toFixed(1)}K`;
        setFormCurrentMc(formatted);
        if (!editingCall) {
          setFormEntryMc(formatted);
        }
      }
      onToast(`Auto-filled telemetry for ${pair.baseToken?.symbol || cleanCa}`);
    } catch {
      onToast('Network error connecting to DexScreener. Enter fields manually.', 'error');
    } finally {
      setFetchingDex(false);
    }
  };

  const handleSubmitForm = async (targetStatus: 'DRAFT' | 'PUBLISHED') => {
    setValidationError(null);
    if (!formCa.trim() || !formName.trim() || !formTicker.trim()) {
      setValidationError('Contract Address (CA), Token Name, and Ticker are required.');
      return;
    }
    const cleanSl = formStopLoss.trim();
    if (cleanSl.startsWith('+') || /^\+?\d+%\s*TP/i.test(cleanSl)) {
      setValidationError('Stop loss cannot be a positive percentage target.');
      return;
    }
    if (formDestinations.length === 0) {
      setValidationError('Select at least one publishing destination.');
      return;
    }

    const includesMax = formDestinations.includes('MAX_ALPHA');
    const derivedCallType = includesMax ? 'MAX_ALPHA' : 'ALPHA';
    const derivedMinTier = includesMax ? 'PRO' : 'LAB_MEMBER';

    setSubmittingMode(targetStatus);
    if (editingCall) {
      const ok = await onUpdateCall(editingCall.id, {
        name: formName.trim(),
        ticker: formTicker.trim(),
        ca: formCa.trim(),
        chain: formChain,
        category: formCategory,
        caller: formCaller.trim() || '@TrenchLabsAdmin',
        serialTag: formSerialTag.trim() || undefined,
        marketCap: formCurrentMc.trim() || '$250K',
        entryMarketCap: formEntryMc.trim() || formCurrentMc.trim() || '$250K',
        risk: formRiskLevel,
        stopLoss: cleanSl || '-25% SL',
        takeProfitInput: formTakeProfits.trim() || '2x, 5x, 10x',
        pinned: formPinned,
        destinations: formDestinations,
        callType: derivedCallType,
        isMaxAlpha: includesMax,
        minTier: derivedMinTier,
        publishStatus: targetStatus,
        summary: formSummary.trim(),
        logoUrl: formLogoUrl.trim() || undefined,
      });
      setSubmittingMode(null);
      if (ok) {
        onToast(
          targetStatus === 'DRAFT'
            ? `Saved ${formTicker.toUpperCase()} updates to Drafts`
            : `Updated & published ${formTicker.toUpperCase()} (${formDestinations.join(' + ')})`
        );
        resetForm();
        setStatusFilter(targetStatus);
        setSubTab('CONTENT');
      } else {
        setValidationError(adminActionError || 'Update rejected. Ensure Master Admin wallet signature succeeded.');
      }
      return;
    }

    const ok = await onCreateCall({
      name: formName.trim(),
      ticker: formTicker.trim(),
      ca: formCa.trim(),
      chain: formChain,
      category: formCategory,
      caller: formCaller.trim() || '@TrenchLabsAdmin',
      marketCap: formCurrentMc.trim() || '$250K',
      entryMarketCap: formEntryMc.trim() || formCurrentMc.trim() || '$250K',
      risk: formRiskLevel,
      stopLoss: cleanSl || '-25% SL',
      takeProfitInput: formTakeProfits.trim() || '2x, 5x, 10x',
      pinned: formPinned,
      destinations: formDestinations,
      callType: derivedCallType,
      isMaxAlpha: includesMax,
      minTier: derivedMinTier,
      publishStatus: targetStatus,
      summary: formSummary.trim(),
      serialTag: formSerialTag.trim() || nextSerialTag,
      logoUrl: formLogoUrl.trim() || undefined,
    });
    setSubmittingMode(null);
    if (ok) {
      onToast(
        targetStatus === 'DRAFT'
          ? `Saved ${formTicker.toUpperCase()} to Drafts`
          : `Published ${formTicker.toUpperCase()} to ${formDestinations.join(' & ')}`
      );
      resetForm();
      setStatusFilter(targetStatus);
      setSubTab('CONTENT');
    } else {
      setValidationError(adminActionError || 'Publish rejected. Ensure Master Admin wallet signature succeeded.');
    }
  };

  const handleLifecycleChange = async (item: AlphaItem, nextStatus: PublicationStatus) => {
    setBusyRowId(item.id);
    const ok = await onUpdateCall(item.id, { publishStatus: nextStatus });
    setBusyRowId(null);
    if (ok) {
      onToast(
        nextStatus === 'PUBLISHED'
          ? `Published ${item.ticker}`
          : nextStatus === 'ARCHIVED'
          ? `Archived ${item.ticker}`
          : `Moved ${item.ticker} to Drafts`
      );
    } else {
      onToast(adminActionError || `Could not update status for ${item.ticker}`, 'error');
    }
  };

  const handleDeleteRow = async (item: AlphaItem) => {
    setBusyRowId(item.id);
    const ok = await onDeleteCall(item.id);
    setBusyRowId(null);
    setConfirmDeleteId(null);
    if (ok) {
      onToast(`Deleted ${item.ticker}`);
    } else {
      onToast(adminActionError || `Could not delete ${item.ticker}`, 'error');
    }
  };

  // Live Card Preview Model constructed strictly from form state
  const previewItem: AlphaItem = useMemo(() => {
    const cleanTicker = formTicker.trim()
      ? formTicker.trim().startsWith('$')
        ? formTicker.trim()
        : `$${formTicker.trim()}`
      : '$TOKEN';
    const isMax = formDestinations.includes('MAX_ALPHA');
    const parsedTps = formTakeProfits
      .split(/[,\s/]+/)
      .map((s) => parseFloat(s.replace(/x/i, '')))
      .filter((n) => Number.isFinite(n) && n > 0)
      .slice(0, 3)
      .map((m) => ({ label: `${m}x`, multiple: m, hit: false }));

    return {
      id: editingCall?.id || 'admin-preview',
      name: formName.trim() || 'Preview Token',
      ticker: cleanTicker,
      chain: formChain,
      quoteToken: 'SOL',
      status: 'LIVE',
      statusLabel: formPinned ? 'PRIORITY CALL' : 'LIVE CALL',
      category: formCategory,
      allocationLabel: 'Allocation',
      allocation: '15.0 SOL',
      endsAt: null,
      risk: Math.min(5, Math.max(1, formRiskLevel || 3)),
      riskRewardRatio: `Risk Lvl ${Math.min(5, Math.max(1, formRiskLevel || 3))}/5`,
      stopLoss: formStopLoss.trim() || '-25% SL',
      takeProfits: parsedTps.length > 0 ? parsedTps : [{ label: '2x', multiple: 2, hit: false }],
      pinned: formPinned,
      pinnedAt: formPinned ? new Date().toISOString() : null,
      entryMarketCap: formEntryMc.trim() || formCurrentMc.trim() || '$250K',
      entryMarketCapUsd: 250000,
      minTier: isMax ? 'PRO' : 'LAB_MEMBER',
      minTierLabel: isMax ? 'Pro Member' : 'Lab Member',
      minBalanceRequired: 1,
      locked: false,
      ca: formCa.trim() || 'So11111111111111111111111111111111111111112',
      links: [],
      summary:
        formSummary.trim() ||
        `Admin setup preview for ${formChain}. Enter thesis summary to describe the catalyst and invalidation.`,
      marketCap: formCurrentMc.trim() || '$250K',
      marketCapUsd: 250000,
      volume24h: '—',
      netInflow24h: '—',
      change24hPct: null,
      age: 'Preview',
      ageMinutes: 1,
      caller: formCaller.trim() || '@TrenchLabsAdmin',
      callerWinRate: '—',
      deployedVia: 'https://trenchlabshq.xyz',
      serialTag: formSerialTag.trim() || nextSerialTag,
      outcome: 'PENDING',
      callType: isMax ? 'MAX_ALPHA' : 'ALPHA',
      isMaxAlpha: isMax,
      destinations: formDestinations,
      logoUrl: formLogoUrl.trim() || undefined,
      sparkline: [],
      art: {
        bgFrom: '#161C24',
        bgTo: '#0A0E13',
        accent: '#34D399',
        secondary: '#6EE7B7',
        motif: 'pill',
        badgeText: formPinned ? 'PINNED CALL' : formChain,
      },
    };
  }, [
    editingCall?.id,
    formCa,
    formCaller,
    formCategory,
    formChain,
    formCurrentMc,
    formDestinations,
    formEntryMc,
    formLogoUrl,
    formName,
    formPinned,
    formRiskLevel,
    formSerialTag,
    formStopLoss,
    formSummary,
    formTakeProfits,
    formTicker,
    nextSerialTag,
  ]);

  return (
    <div data-testid="admin-workspace" className="space-y-6">
      {/* 1. Publishing Overview Header Strip */}
      <div className="rounded-xl bg-surface border border-border-default p-5 sm:p-6 space-y-5">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-border-default">
          <div className="flex items-start sm:items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-brand/15 border border-brand/40 flex items-center justify-center text-brand shrink-0">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="font-sans text-base sm:text-lg font-black text-white uppercase tracking-tight">
                  Publishing Overview
                </h3>
                <span className="px-2 py-0.5 rounded bg-brand text-canvas font-mono text-[10px] font-black uppercase">
                  MASTER ADMIN
                </span>
              </div>
              <p className="font-sans text-xs text-muted mt-0.5">
                Centralized publishing, drafts, archive lifecycle, destinations, and Raid campaign verification.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/admin/ledger"
              className="h-9 px-3.5 rounded-lg bg-surface-card hover:bg-surface-3 border border-border-default hover:border-brand text-white font-sans text-xs font-bold inline-flex items-center gap-1.5 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand focus-visible:outline-offset-2"
            >
              <BookOpen className="w-3.5 h-3.5 text-brand" />
              <span>Performance Ledger Admin</span>
              <ArrowUpRight className="w-3.5 h-3.5 text-muted" />
            </Link>
            <Button
              type="button"
              variant="primary"
              size="sm"
              data-testid="admin-create-call-btn"
              onClick={handleOpenNewEditor}
              className="h-9 px-4 text-xs font-black uppercase gap-1.5"
            >
              <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
              <span>Create Call</span>
            </Button>
          </div>
        </div>

        {/* 4 Overview Metric Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 font-mono text-xs">
          <div className="p-3.5 rounded-lg bg-surface-card border border-border-default space-y-1">
            <div className="text-[11px] font-bold uppercase tracking-wider text-muted flex items-center justify-between">
              <span>Published Calls</span>
              <CheckCircle2 className="w-3.5 h-3.5 text-brand" />
            </div>
            <div className="text-xl font-black text-white tnum">{counts.published}</div>
            <div className="text-[11px] text-dim tnum">
              {counts.alphaDest} Alpha &bull; {counts.maxAlphaDest} Max &bull; {counts.dualDest} Dual
            </div>
          </div>

          <div className="p-3.5 rounded-lg bg-surface-card border border-border-default space-y-1">
            <div className="text-[11px] font-bold uppercase tracking-wider text-muted flex items-center justify-between">
              <span>Drafts</span>
              <FileEdit className="w-3.5 h-3.5 text-amber" />
            </div>
            <div className="text-xl font-black text-amber tnum">{counts.drafts}</div>
            <div className="text-[11px] text-dim">Not visible on member feeds</div>
          </div>

          <div className="p-3.5 rounded-lg bg-surface-card border border-border-default space-y-1">
            <div className="text-[11px] font-bold uppercase tracking-wider text-muted flex items-center justify-between">
              <span>Archived</span>
              <Archive className="w-3.5 h-3.5 text-muted" />
            </div>
            <div className="text-xl font-black text-white tnum">{counts.archived}</div>
            <div className="text-[11px] text-dim">Unpublished history retained</div>
          </div>

          <div className="p-3.5 rounded-lg bg-surface-card border border-border-default space-y-1">
            <div className="text-[11px] font-bold uppercase tracking-wider text-muted flex items-center justify-between">
              <span>Active Raids</span>
              <Sparkles className="w-3.5 h-3.5 text-raid-primary" />
            </div>
            <div className="text-xl font-black text-raid-primary tnum">{counts.activeRaids}</div>
            <div className="text-[11px] text-dim tnum">{campaigns.length} total campaigns</div>
          </div>
        </div>

        {/* Sub-Workspace Navigation */}
        <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-border-default">
          <button
            type="button"
            data-testid="admin-subtab-content"
            onClick={() => setSubTab('CONTENT')}
            className={`h-9 px-4 rounded-lg font-sans text-xs font-bold inline-flex items-center gap-2 transition-colors cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand focus-visible:outline-offset-2 ${
              subTab === 'CONTENT'
                ? 'bg-brand text-canvas font-black'
                : 'bg-surface-card text-muted hover:text-white border border-border-default'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>Content Management ({items.length})</span>
          </button>

          <button
            type="button"
            data-testid="admin-subtab-editor"
            onClick={() => setSubTab('EDITOR')}
            className={`h-9 px-4 rounded-lg font-sans text-xs font-bold inline-flex items-center gap-2 transition-colors cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand focus-visible:outline-offset-2 ${
              subTab === 'EDITOR'
                ? 'bg-brand text-canvas font-black'
                : 'bg-surface-card text-muted hover:text-white border border-border-default'
            }`}
          >
            <Pencil className="w-3.5 h-3.5" />
            <span>{editingCall ? `Edit: ${editingCall.ticker}` : 'Create Content'}</span>
          </button>

          <button
            type="button"
            data-testid="admin-subtab-campaigns"
            onClick={() => setSubTab('CAMPAIGNS')}
            className={`h-9 px-4 rounded-lg font-sans text-xs font-bold inline-flex items-center gap-2 transition-colors cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand focus-visible:outline-offset-2 ${
              subTab === 'CAMPAIGNS'
                ? 'bg-brand text-canvas font-black'
                : 'bg-surface-card text-muted hover:text-white border border-border-default'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Raid Campaigns ({campaigns.length})</span>
          </button>
        </div>
      </div>

      {/* 2A. CONTENT MANAGEMENT: Published / Drafts / Archived Table */}
      {subTab === 'CONTENT' && (
        <div className="rounded-xl bg-surface border border-border-default overflow-hidden">
          <div className="p-4 sm:p-5 bg-surface-card border-b border-border-default space-y-3">
            <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3">
              {/* Publication Status Filter Tabs */}
              <div className="inline-flex flex-wrap items-center gap-1 bg-surface border border-border-default rounded-lg p-1 font-sans text-xs shrink-0">
                {(
                  [
                    { id: 'PUBLISHED', label: 'Published', count: counts.published },
                    { id: 'DRAFT', label: 'Drafts', count: counts.drafts },
                    { id: 'ARCHIVED', label: 'Archived', count: counts.archived },
                    { id: 'ALL', label: 'All Posts', count: counts.total },
                  ] as { id: ContentStatusFilter; label: string; count: number }[]
                ).map((tab) => {
                  const active = statusFilter === tab.id;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      data-testid={`admin-status-tab-${tab.id.toLowerCase()}`}
                      onClick={() => setStatusFilter(tab.id)}
                      className={`h-8 px-3 rounded-md font-bold inline-flex items-center gap-1.5 transition-colors cursor-pointer text-xs whitespace-nowrap focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand focus-visible:outline-offset-2 ${
                        active ? 'bg-brand text-canvas' : 'text-muted hover:text-white'
                      }`}
                    >
                      <span>{tab.label}</span>
                      <span
                        className={`px-1.5 py-0.2 rounded font-mono text-[11px] tnum ${
                          active ? 'bg-canvas/20 text-canvas' : 'bg-surface-card text-white'
                        }`}
                      >
                        {tab.count}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* Admin Search + Destination + Chain Filters */}
              <div className="flex flex-wrap sm:flex-nowrap items-center gap-2 flex-1 xl:justify-end">
                <div className="relative min-w-[180px] flex-1 xl:max-w-[260px]">
                  <Search className="w-3.5 h-3.5 text-muted absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search posts (ticker, CA, caller)..."
                    className="w-full h-9 pl-8 pr-3 rounded-lg bg-surface border border-border-default focus:border-brand font-sans text-xs text-white placeholder:text-dim focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                  />
                </div>

                <select
                  aria-label="Filter by destination"
                  value={destFilter}
                  onChange={(e) => setDestFilter(e.target.value as DestinationFilter)}
                  className="h-9 px-2.5 rounded-lg bg-surface border border-border-default font-sans text-xs text-white cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand focus-visible:outline-offset-2"
                >
                  <option value="ALL">All Destinations</option>
                  <option value="ALPHA">Alpha Calls</option>
                  <option value="MAX_ALPHA">Max Alpha</option>
                  <option value="DUAL">Alpha + Max Alpha</option>
                </select>

                <select
                  aria-label="Filter by chain"
                  value={chainFilter}
                  onChange={(e) => setChainFilter(e.target.value as Chain | 'ALL')}
                  className="h-9 px-2.5 rounded-lg bg-surface border border-border-default font-mono text-xs text-white cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand focus-visible:outline-offset-2"
                >
                  <option value="ALL">All Chains</option>
                  {CHAINS.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[820px]">
              <thead>
                <tr className="border-b border-border-default bg-surface-card/60 font-mono text-[11px] text-muted uppercase tracking-wider">
                  <th className="py-3 px-4 font-bold">Serial &amp; Token</th>
                  <th className="py-3 px-4 font-bold">Destinations</th>
                  <th className="py-3 px-4 text-right font-bold">Entry / Current MC</th>
                  <th className="py-3 px-4 text-center font-bold">Outcome</th>
                  <th className="py-3 px-4 text-center font-bold">Status</th>
                  <th className="py-3 px-4 text-right font-bold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-default text-xs">
                {filteredItems.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-10 text-center text-muted font-sans text-xs">
                      No posts match this filter in {statusFilter.toLowerCase()} view.
                    </td>
                  </tr>
                ) : (
                  filteredItems.map((item) => {
                    const pubStatus = getItemPublishStatus(item);
                    const dests = getItemDestinations(item);
                    const isBusy = busyRowId === item.id;

                    return (
                      <tr key={item.id} className="hover:bg-surface-card/60 transition-colors">
                        <td className="py-3.5 px-4">
                          <div className="flex items-center gap-2.5">
                            <span className="font-mono text-[11px] font-bold text-alpha-primary w-12 shrink-0 tnum">
                              {item.serialTag || '—'}
                            </span>
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="font-sans font-bold text-white">{item.name}</span>
                                <span className="font-mono font-bold text-brand">{item.ticker}</span>
                                <span className="px-1.5 py-0.2 rounded bg-surface-card border border-border-default font-mono text-[11px] font-bold text-white">
                                  {item.chain}
                                </span>
                                {item.pinned && (
                                  <span className="px-1.5 py-0.2 rounded bg-brand/20 text-brand font-mono text-[10px] font-black uppercase">
                                    Pinned
                                  </span>
                                )}
                              </div>
                              <div className="font-mono text-[11px] text-dim mt-0.5 truncate max-w-[260px]">
                                {item.caller} &bull; {item.ca ? `${item.ca.slice(0, 6)}...${item.ca.slice(-4)}` : 'No CA'}
                              </div>
                            </div>
                          </div>
                        </td>

                        <td className="py-3.5 px-4">
                          <div className="flex flex-wrap items-center gap-1">
                            {dests.includes('ALPHA') && (
                              <span className="px-2 py-0.5 rounded bg-purple-950/50 border border-purple-500/40 text-purple-300 font-mono text-[11px] font-bold">
                                ALPHA
                              </span>
                            )}
                            {dests.includes('MAX_ALPHA') && (
                              <span className="px-2 py-0.5 rounded bg-amber-950/50 border border-amber-500/40 text-amber-300 font-mono text-[11px] font-bold">
                                MAX ALPHA
                              </span>
                            )}
                            {dests.length === 0 && (
                              <span className="px-2 py-0.5 rounded bg-surface-card border border-border-default text-muted font-mono text-[11px]">
                                LEGACY ({item.callType})
                              </span>
                            )}
                          </div>
                        </td>

                        <td className="py-3.5 px-4 text-right font-mono tnum">
                          <div className="text-white font-bold">{item.entryMarketCap || '—'}</div>
                          <div className="text-brand font-black">{item.marketCap || '—'}</div>
                        </td>

                        <td className="py-3.5 px-4">
                          <div className="flex items-center justify-center gap-1">
                            <button
                              type="button"
                              onClick={() => onSetOutcome(item.id, 'PROFIT')}
                              title="Mark Profit"
                              className={`h-7 px-2 rounded border font-mono text-[11px] font-bold cursor-pointer transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand focus-visible:outline-offset-2 ${
                                item.outcome === 'PROFIT'
                                  ? 'bg-brand text-canvas border-brand'
                                  : 'bg-surface-card border-border-default text-muted hover:text-brand'
                              }`}
                            >
                              <TrendingUp className="w-3 h-3 inline mr-0.5" />
                              W
                            </button>
                            <button
                              type="button"
                              onClick={() => onSetOutcome(item.id, 'LOSS')}
                              title="Mark Loss"
                              className={`h-7 px-2 rounded border font-mono text-[11px] font-bold cursor-pointer transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand focus-visible:outline-offset-2 ${
                                item.outcome === 'LOSS'
                                  ? 'bg-danger text-white border-danger'
                                  : 'bg-surface-card border-border-default text-muted hover:text-danger'
                              }`}
                            >
                              <TrendingDown className="w-3 h-3 inline mr-0.5" />
                              L
                            </button>
                          </div>
                        </td>

                        <td className="py-3.5 px-4 text-center">
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded font-mono text-[11px] font-bold uppercase border ${
                              pubStatus === 'PUBLISHED'
                                ? 'bg-brand/15 text-brand border-brand/40'
                                : pubStatus === 'DRAFT'
                                ? 'bg-amber-950/50 text-amber-300 border-amber-500/40'
                                : 'bg-surface-card text-muted border-border-default'
                            }`}
                          >
                            {pubStatus}
                          </span>
                        </td>

                        <td className="py-3.5 px-4 text-right">
                          <div className="inline-flex items-center justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={() => onInspect(item)}
                              title="Preview Details"
                              aria-label={`Preview ${item.ticker}`}
                              className="h-7 w-7 rounded border border-border-default bg-surface-card hover:border-brand text-muted hover:text-white inline-flex items-center justify-center cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand focus-visible:outline-offset-2"
                            >
                              <Eye className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleStartEdit(item)}
                              title="Edit Call"
                              aria-label={`Edit ${item.ticker}`}
                              className="h-7 w-7 rounded border border-border-default bg-surface-card hover:border-brand text-muted hover:text-brand inline-flex items-center justify-center cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand focus-visible:outline-offset-2"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => onTogglePin(item.id, !item.pinned)}
                              title={item.pinned ? 'Unpin' : 'Pin Priority'}
                              aria-label={`Toggle Pin ${item.ticker}`}
                              className={`h-7 w-7 rounded border inline-flex items-center justify-center cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand focus-visible:outline-offset-2 ${
                                item.pinned
                                  ? 'bg-brand text-canvas border-brand'
                                  : 'border-border-default bg-surface-card text-muted hover:text-white'
                              }`}
                            >
                              <Pin className="w-3.5 h-3.5" />
                            </button>

                            {pubStatus !== 'PUBLISHED' ? (
                              <button
                                type="button"
                                disabled={isBusy}
                                onClick={() => handleLifecycleChange(item, 'PUBLISHED')}
                                className="h-7 px-2.5 rounded bg-brand hover:bg-brand-bright text-canvas font-sans text-[11px] font-black uppercase cursor-pointer disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand focus-visible:outline-offset-2"
                              >
                                Publish
                              </button>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  disabled={isBusy}
                                  onClick={() => handleLifecycleChange(item, 'DRAFT')}
                                  title="Unpublish to Drafts"
                                  className="h-7 px-2 rounded border border-border-default bg-surface-card hover:border-amber text-muted hover:text-amber font-sans text-[11px] font-bold cursor-pointer disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand focus-visible:outline-offset-2"
                                >
                                  Draft
                                </button>
                                <button
                                  type="button"
                                  disabled={isBusy}
                                  onClick={() => handleLifecycleChange(item, 'ARCHIVED')}
                                  title="Archive Call"
                                  className="h-7 w-7 rounded border border-border-default bg-surface-card hover:border-amber text-muted hover:text-amber inline-flex items-center justify-center cursor-pointer disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand focus-visible:outline-offset-2"
                                >
                                  <Archive className="w-3.5 h-3.5" />
                                </button>
                              </>
                            )}

                            {confirmDeleteId === item.id ? (
                              <button
                                type="button"
                                disabled={isBusy}
                                onClick={() => handleDeleteRow(item)}
                                className="h-7 px-2 rounded bg-danger text-white font-sans text-[11px] font-black cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand focus-visible:outline-offset-2"
                              >
                                Confirm
                              </button>
                            ) : (
                              <button
                                type="button"
                                disabled={isBusy}
                                onClick={() => setConfirmDeleteId(item.id)}
                                title="Delete Call"
                                aria-label={`Delete ${item.ticker}`}
                                className="h-7 w-7 rounded border border-border-default bg-surface-card hover:border-danger text-muted hover:text-danger inline-flex items-center justify-center cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand focus-visible:outline-offset-2"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 2B. CREATE / EDIT CONTENT STUDIO + LIVE PREVIEW */}
      {subTab === 'EDITOR' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Form Column */}
          <div className="lg:col-span-7 rounded-xl bg-surface border border-border-default p-5 sm:p-6 space-y-5">
            <div className="flex items-center justify-between gap-3 pb-3 border-b border-border-default">
              <div>
                <h4 className="font-sans text-base font-black text-white uppercase tracking-tight">
                  {editingCall ? `Edit Call: ${editingCall.ticker}` : 'Create New Call'}
                </h4>
                <p className="font-sans text-xs text-muted mt-0.5">
                  Configure setup telemetry, publishing destination(s), and preview before publishing.
                </p>
              </div>
              {editingCall && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    resetForm();
                    setSubTab('CONTENT');
                  }}
                  className="text-xs text-muted hover:text-white"
                >
                  Cancel Edit
                </Button>
              )}
            </div>

            {validationError && (
              <div
                role="alert"
                className="rounded-lg bg-danger/10 border border-danger/40 p-3 flex items-center gap-2 font-sans text-xs text-danger font-semibold"
              >
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{validationError}</span>
              </div>
            )}

            {/* Contract Address + Auto-fill */}
            <div className="space-y-1.5">
              <label htmlFor="admin-form-ca" className="block font-sans text-xs font-bold text-muted uppercase">
                Contract Address (CA) *
              </label>
              <div className="flex gap-2">
                <input
                  id="admin-form-ca"
                  type="text"
                  value={formCa}
                  onChange={(e) => setFormCa(e.target.value)}
                  placeholder="Paste Solana or EVM token contract address..."
                  className="flex-1 h-10 px-3 rounded-lg bg-surface-card border border-border-default focus:border-brand font-mono text-xs text-white placeholder:text-dim focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                />
                <Button
                  type="button"
                  variant="secondary"
                  size="md"
                  onClick={handleAutoFillDexScreener}
                  disabled={fetchingDex}
                  loading={fetchingDex}
                  className="h-10 px-3.5 text-xs font-bold text-brand shrink-0"
                >
                  {fetchingDex ? 'Fetching...' : 'Auto-fill'}
                </Button>
              </div>
            </div>

            {/* Identity Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-1">
                <label htmlFor="admin-form-name" className="block font-sans text-xs font-bold text-muted uppercase">
                  Token Name *
                </label>
                <input
                  id="admin-form-name"
                  type="text"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="e.g. Synapse Labs"
                  className="w-full h-10 px-3 rounded-lg bg-surface-card border border-border-default focus:border-brand font-sans text-xs text-white placeholder:text-dim focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                />
              </div>

              <div className="space-y-1">
                <label htmlFor="admin-form-ticker" className="block font-sans text-xs font-bold text-muted uppercase">
                  Ticker *
                </label>
                <input
                  id="admin-form-ticker"
                  type="text"
                  value={formTicker}
                  onChange={(e) => setFormTicker(e.target.value)}
                  placeholder="e.g. $SYN"
                  className="w-full h-10 px-3 rounded-lg bg-surface-card border border-border-default focus:border-brand font-mono text-xs text-white placeholder:text-dim focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                />
              </div>

              <div className="space-y-1">
                <label htmlFor="admin-form-chain" className="block font-sans text-xs font-bold text-muted uppercase">
                  Chain
                </label>
                <select
                  id="admin-form-chain"
                  value={formChain}
                  onChange={(e) => setFormChain(e.target.value as Chain)}
                  className="w-full h-10 px-3 rounded-lg bg-surface-card border border-border-default focus:border-brand font-mono text-xs text-white cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                >
                  {CHAINS.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Metadata & Risk Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <div className="space-y-1">
                <label htmlFor="admin-form-entry-mc" className="block font-sans text-xs font-bold text-muted uppercase">
                  Entry MC
                </label>
                <input
                  id="admin-form-entry-mc"
                  type="text"
                  value={formEntryMc}
                  onChange={(e) => setFormEntryMc(e.target.value)}
                  placeholder="$250K"
                  className="w-full h-10 px-3 rounded-lg bg-surface-card border border-border-default focus:border-brand font-mono text-xs text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                />
              </div>

              <div className="space-y-1">
                <label htmlFor="admin-form-current-mc" className="block font-sans text-xs font-bold text-muted uppercase">
                  Current MC
                </label>
                <input
                  id="admin-form-current-mc"
                  type="text"
                  value={formCurrentMc}
                  onChange={(e) => setFormCurrentMc(e.target.value)}
                  placeholder="$250K"
                  className="w-full h-10 px-3 rounded-lg bg-surface-card border border-border-default focus:border-brand font-mono text-xs text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                />
              </div>

              <div className="space-y-1">
                <label htmlFor="admin-form-risk" className="block font-sans text-xs font-bold text-muted uppercase">
                  Risk (1-5)
                </label>
                <input
                  id="admin-form-risk"
                  type="number"
                  min={1}
                  max={5}
                  value={formRiskLevel}
                  onChange={(e) => setFormRiskLevel(Number(e.target.value))}
                  className="w-full h-10 px-3 rounded-lg bg-surface-card border border-border-default focus:border-brand font-mono text-xs text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                />
              </div>

              <div className="space-y-1">
                <label htmlFor="admin-form-sl" className="block font-sans text-xs font-bold text-muted uppercase">
                  Stop Loss (SL)
                </label>
                <input
                  id="admin-form-sl"
                  type="text"
                  value={formStopLoss}
                  onChange={(e) => setFormStopLoss(e.target.value)}
                  placeholder="-25% SL"
                  className="w-full h-10 px-3 rounded-lg bg-surface-card border border-border-default focus:border-brand font-mono text-xs text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                />
              </div>

              <div className="space-y-1">
                <label htmlFor="admin-form-tp" className="block font-sans text-xs font-bold text-muted uppercase">
                  Take Profits
                </label>
                <input
                  id="admin-form-tp"
                  type="text"
                  value={formTakeProfits}
                  onChange={(e) => setFormTakeProfits(e.target.value)}
                  placeholder="2x, 5x, 10x"
                  className="w-full h-10 px-3 rounded-lg bg-surface-card border border-border-default focus:border-brand font-mono text-xs text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                />
              </div>

              <div className="space-y-1">
                <label htmlFor="admin-form-category" className="block font-sans text-xs font-bold text-muted uppercase">
                  Category
                </label>
                <select
                  id="admin-form-category"
                  value={formCategory}
                  onChange={(e) => setFormCategory(e.target.value as AlphaCategory)}
                  className="w-full h-10 px-3 rounded-lg bg-surface-card border border-border-default focus:border-brand font-mono text-xs text-white cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                >
                  {CATEGORIES.map((cat) => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label htmlFor="admin-form-caller" className="block font-sans text-xs font-bold text-muted uppercase">
                  Caller Attribution
                </label>
                <input
                  id="admin-form-caller"
                  type="text"
                  value={formCaller}
                  onChange={(e) => setFormCaller(e.target.value)}
                  placeholder="@TrenchLabsAdmin"
                  className="w-full h-10 px-3 rounded-lg bg-surface-card border border-border-default focus:border-brand font-mono text-xs text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                />
              </div>

              <div className="space-y-1">
                <label htmlFor="admin-form-serial" className="block font-sans text-xs font-bold text-muted uppercase">
                  Serial Tag
                </label>
                <input
                  id="admin-form-serial"
                  type="text"
                  value={formSerialTag}
                  onChange={(e) => setFormSerialTag(e.target.value)}
                  placeholder={nextSerialTag}
                  className="w-full h-10 px-3 rounded-lg bg-surface-card border border-border-default focus:border-brand font-mono text-xs text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                />
              </div>
            </div>

            <div className="space-y-1">
              <label htmlFor="admin-form-summary" className="block font-sans text-xs font-bold text-muted uppercase">
                Thesis / Research Summary
              </label>
              <textarea
                id="admin-form-summary"
                rows={3}
                value={formSummary}
                onChange={(e) => setFormSummary(e.target.value)}
                placeholder="Catalyst summary, on-chain flow metrics, and key invalidation notes..."
                className="w-full p-3 rounded-lg bg-surface-card border border-border-default focus:border-brand font-sans text-xs text-white placeholder:text-dim focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              />
            </div>

            {/* Publishing Destinations Selector (Section 17.3) */}
            <div className="space-y-2 pt-1">
              <div className="flex items-center justify-between">
                <span className="font-sans text-xs font-bold text-muted uppercase tracking-wider">
                  Publishing Destination(s) *
                </span>
                <span className="font-mono text-[11px] text-dim">
                  Select one or both (single database record)
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <button
                  type="button"
                  data-testid="dest-select-alpha"
                  aria-pressed={formDestinations.includes('ALPHA')}
                  onClick={() => toggleDestination('ALPHA')}
                  className={`p-3.5 rounded-xl border text-left transition-colors cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand focus-visible:outline-offset-2 ${
                    formDestinations.includes('ALPHA')
                      ? 'bg-purple-950/35 border-purple-500 text-white'
                      : 'bg-surface-card border-border-default text-muted hover:text-white'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1.5 font-sans text-xs font-black uppercase text-purple-300">
                      <Target className="w-3.5 h-3.5" />
                      <span>Alpha Calls</span>
                    </span>
                    <span className="inline-flex items-center gap-1 font-mono text-[11px] font-bold">
                      {formDestinations.includes('ALPHA') && <Check className="w-3.5 h-3.5 text-brand" />}
                      <span>MEMBER+</span>
                    </span>
                  </div>
                  <p className="font-sans text-xs text-muted mt-1 leading-snug">
                    Publishes to Alpha Calls workspace for Member &amp; PRO tiers.
                  </p>
                </button>

                <button
                  type="button"
                  data-testid="dest-select-max-alpha"
                  aria-pressed={formDestinations.includes('MAX_ALPHA')}
                  onClick={() => toggleDestination('MAX_ALPHA')}
                  className={`p-3.5 rounded-xl border text-left transition-colors cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand focus-visible:outline-offset-2 ${
                    formDestinations.includes('MAX_ALPHA')
                      ? 'bg-amber-950/35 border-amber-500 text-white'
                      : 'bg-surface-card border-border-default text-muted hover:text-white'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1.5 font-sans text-xs font-black uppercase text-amber-300">
                      <Flame className="w-3.5 h-3.5" />
                      <span>Max Alpha</span>
                    </span>
                    <span className="inline-flex items-center gap-1 font-mono text-[11px] font-bold">
                      {formDestinations.includes('MAX_ALPHA') && <Check className="w-3.5 h-3.5 text-brand" />}
                      <span>PRO ONLY</span>
                    </span>
                  </div>
                  <p className="font-sans text-xs text-muted mt-1 leading-snug">
                    Sets isMaxAlpha &amp; callType=MAX_ALPHA for PRO workspace exclusivity.
                  </p>
                </button>
              </div>

              <div className="rounded-lg bg-surface-card border border-border-default px-3 py-2 flex flex-wrap items-center justify-between gap-2 font-mono text-[11px] text-muted">
                <span>
                  Classification: <strong className="text-white">callType={formDestinations.includes('MAX_ALPHA') ? 'MAX_ALPHA' : 'ALPHA'}</strong> &bull;{' '}
                  <strong className="text-white">isMaxAlpha={String(formDestinations.includes('MAX_ALPHA'))}</strong>
                </span>
                <span className="text-dim">Watchlist remains user-saved only</span>
              </div>
            </div>

            {/* Footer Controls */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-border-default">
              <label className="inline-flex items-center gap-2 font-sans text-xs font-bold text-white cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={formPinned}
                  onChange={(e) => setFormPinned(e.target.checked)}
                  className="w-4 h-4 rounded border-border-default text-brand focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand focus-visible:outline-offset-2"
                />
                <Pin className="w-3.5 h-3.5 text-brand" />
                <span>Pin Priority to Top</span>
              </label>

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  size="md"
                  data-testid="admin-save-draft-btn"
                  disabled={Boolean(submittingMode)}
                  loading={submittingMode === 'DRAFT'}
                  onClick={() => handleSubmitForm('DRAFT')}
                  className="h-10 px-4 text-xs font-bold"
                >
                  <FileText className="w-3.5 h-3.5 mr-1.5" />
                  <span>Save Draft</span>
                </Button>

                <Button
                  type="button"
                  variant="primary"
                  size="md"
                  data-testid="admin-publish-now-btn"
                  disabled={Boolean(submittingMode)}
                  loading={submittingMode === 'PUBLISHED'}
                  onClick={() => handleSubmitForm('PUBLISHED')}
                  className="h-10 px-5 text-xs font-black uppercase"
                >
                  <Send className="w-3.5 h-3.5 mr-1.5" />
                  <span>{editingCall ? 'Save & Publish' : 'Publish Immediately'}</span>
                </Button>
              </div>
            </div>
          </div>

          {/* Right Live Preview Column */}
          <div className="lg:col-span-5 rounded-xl bg-surface border border-border-default p-5 sm:p-6 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-border-default">
              <div>
                <h4 className="font-sans text-sm font-black text-white uppercase tracking-wider">
                  Live Card Preview
                </h4>
                <p className="font-sans text-xs text-muted mt-0.5">
                  Preview how this call renders on user feeds before publishing
                </p>
              </div>
              <span className="px-2 py-0.5 rounded bg-surface-card border border-border-default font-mono text-[11px] font-bold text-brand">
                {formDestinations.join(' + ')}
              </span>
            </div>

            <div className="pointer-events-none select-none">
              <AlphaCallCard coin={previewItem} isAdmin={false} isStarred={false} />
            </div>

            <p className="font-sans text-[11px] text-dim leading-relaxed">
              Note: Saving as a Draft stores the call privately inside the Admin Drafts queue without exposing it to user feeds or sending Telegram alerts.
            </p>
          </div>
        </div>
      )}

      {/* 2C. RAID CAMPAIGNS & AIRDROPS */}
      {subTab === 'CAMPAIGNS' && (
        <div className="rounded-xl bg-surface border border-border-default overflow-hidden">
          <AdminCampaignManager onToast={onToast} getAdminHeaders={getAdminHeaders} />
        </div>
      )}
    </div>
  );
};
