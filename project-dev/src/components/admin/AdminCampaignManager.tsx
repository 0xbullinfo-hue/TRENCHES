'use client';

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Campaign, CampaignSubmission } from '@/lib/types';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  ExternalLink,
  Gift,
  Pencil,
  Pin,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
} from 'lucide-react';

interface AdminCampaignManagerProps {
  onToast: (msg: string, type?: 'success' | 'error') => void;
  getAdminHeaders?: (method: string, path: string, body: string) => Promise<Record<string, string>>;
}

export const AdminCampaignManager: React.FC<AdminCampaignManagerProps> = ({
  onToast,
  getAdminHeaders,
}) => {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null);
  const [submissions, setSubmissions] = useState<CampaignSubmission[]>([]);
  const [loadingSubmissions, setLoadingSubmissions] = useState(false);
  const [submissionsError, setSubmissionsError] = useState<string | null>(null);
  const submissionsReqGenRef = useRef(0);
  const selectedCampaignIdRef = useRef<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useLayoutEffect(() => {
    selectedCampaignIdRef.current = selectedCampaignId;
  }, [selectedCampaignId]);

  const selectCampaign = useCallback((campaignId: string | null) => {
    if (campaignId === selectedCampaignIdRef.current) return;
    submissionsReqGenRef.current += 1;
    selectedCampaignIdRef.current = campaignId;
    setSelectedCampaignId(campaignId);
    setSubmissions([]);
    setSubmissionsError(null);
    setLoadingSubmissions(Boolean(campaignId));
  }, []);

  // Form states (Create / Edit)
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editingCampaign, setEditingCampaign] = useState<Campaign | null>(null);
  const [formTitle, setFormTitle] = useState('');
  const [formTweetUrl, setFormTweetUrl] = useState('');
  const [formRewardAmount, setFormRewardAmount] = useState('');
  const [formTotalPool, setFormTotalPool] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formDurationHours, setFormDurationHours] = useState('24');
  const [formPinned, setFormPinned] = useState(false);
  const [submittingCampaign, setSubmittingCampaign] = useState(false);

  // Quick Action feedback
  const [updatingSubId, setUpdatingSubId] = useState<string | null>(null);
  const [copiedWallets, setCopiedWallets] = useState(false);
  const [copiedSingleWallet, setCopiedSingleWallet] = useState<string | null>(null);

  const getHeaders = useCallback(
    async (method: string, path: string, body = ''): Promise<Record<string, string>> => {
      if (getAdminHeaders) {
        try {
          return await getAdminHeaders(method, path, body);
        } catch {
          return {};
        }
      }
      return {};
    },
    [getAdminHeaders]
  );

  const fetchCampaigns = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/campaigns');
      const data = await res.json();
      if (data.ok && Array.isArray(data.campaigns)) {
        setCampaigns(data.campaigns);
        if (data.campaigns.length > 0 && !selectedCampaignIdRef.current) {
          selectCampaign(data.campaigns[0].id);
        }
      }
    } catch {
      onToast('Failed to load campaigns', 'error');
    } finally {
      setLoading(false);
    }
  }, [onToast, selectCampaign]);

  useEffect(() => {
    let active = true;
    const run = async () => {
      try {
        setLoading(true);
        const res = await fetch('/api/campaigns');
        const data = await res.json();
        if (active && data.ok && Array.isArray(data.campaigns)) {
          setCampaigns(data.campaigns);
          if (data.campaigns.length > 0 && !selectedCampaignIdRef.current) {
            selectCampaign(data.campaigns[0].id);
          }
        }
      } catch {
        if (active) onToast('Failed to load campaigns', 'error');
      } finally {
        if (active) setLoading(false);
      }
    };
    run();
    return () => {
      active = false;
    };
  }, [onToast, selectCampaign]);

  const fetchSubmissions = useCallback(
    async (campaignId: string) => {
      const reqGen = ++submissionsReqGenRef.current;
      const isStale = () =>
        !mountedRef.current ||
        submissionsReqGenRef.current !== reqGen ||
        selectedCampaignIdRef.current !== campaignId;

      setLoadingSubmissions(true);
      setSubmissionsError(null);
      try {
        const headers = await getHeaders('GET', `/api/admin/campaigns/${campaignId}/submissions`, '');
        if (isStale()) return;

        const res = await fetch(`/api/admin/campaigns/${campaignId}/submissions`, {
          headers,
        });
        if (isStale()) return;

        let data: { ok?: boolean; submissions?: CampaignSubmission[]; error?: string } | null = null;
        try {
          data = await res.json();
        } catch {
          data = null;
        }
        if (isStale()) return;

        if (!res.ok) {
          const msg =
            res.status === 401 || res.status === 403
              ? 'Authentication required or expired. Please re-verify admin access.'
              : data?.error || `Failed to load campaign submissions (HTTP ${res.status})`;
          setSubmissions([]);
          setSubmissionsError(msg);
          onToast(msg, 'error');
          return;
        }

        if (data?.ok && Array.isArray(data.submissions)) {
          setSubmissions(data.submissions);
          setSubmissionsError(null);
        } else {
          const msg = data?.error || 'Failed to load campaign submissions';
          setSubmissions([]);
          setSubmissionsError(msg);
          onToast(msg, 'error');
        }
      } catch {
        if (isStale()) return;
        const msg = 'Failed to load campaign submissions';
        setSubmissions([]);
        setSubmissionsError(msg);
        onToast(msg, 'error');
      } finally {
        if (!isStale()) {
          setLoadingSubmissions(false);
        }
      }
    },
    [getHeaders, onToast]
  );

  useEffect(() => {
    submissionsReqGenRef.current += 1;
    if (selectedCampaignId) {
      const timer = setTimeout(() => {
        setSubmissions([]);
        setSubmissionsError(null);
        setLoadingSubmissions(true);
        void fetchSubmissions(selectedCampaignId);
      }, 0);
      return () => {
        submissionsReqGenRef.current += 1;
        clearTimeout(timer);
      };
    } else {
      const timer = setTimeout(() => {
        setSubmissions([]);
        setSubmissionsError(null);
        setLoadingSubmissions(false);
      }, 0);
      return () => {
        submissionsReqGenRef.current += 1;
        clearTimeout(timer);
      };
    }
  }, [selectedCampaignId, fetchSubmissions]);

  const handleCreateCampaign = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formTitle.trim() || !formTweetUrl.trim() || !formRewardAmount.trim()) {
      onToast('Please fill in all required fields (*)', 'error');
      return;
    }

    setSubmittingCampaign(true);
    try {
      const isEditing = Boolean(editingCampaign);
      const url = isEditing
        ? `/api/admin/campaigns/${editingCampaign?.id}`
        : '/api/admin/campaigns';
      const method = isEditing ? 'PATCH' : 'POST';
      const bodyStr = JSON.stringify({
        title: formTitle.trim(),
        tweetUrl: formTweetUrl.trim(),
        rewardAmount: formRewardAmount.trim(),
        totalPool: formTotalPool.trim() || undefined,
        description: formDescription.trim(),
        durationHours: Number(formDurationHours) || 24,
        pinned: formPinned,
      });

      const authHeaders = await getHeaders(method, url, bodyStr);

      const res = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders,
        },
        body: bodyStr,
      });

      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || 'Failed to save campaign');
      }

      onToast(isEditing ? 'Campaign updated successfully!' : 'Campaign published live!');
      setShowCreateForm(false);
      setEditingCampaign(null);
      setFormTitle('');
      setFormTweetUrl('');
      setFormRewardAmount('');
      setFormTotalPool('');
      setFormDescription('');
      setFormDurationHours('24');
      setFormPinned(false);
      fetchCampaigns();
      if (data.campaign?.id) {
        setSelectedCampaignId(data.campaign.id);
      }
    } catch (err) {
      onToast((err as Error).message, 'error');
    } finally {
      setSubmittingCampaign(false);
    }
  };

  const handleStartEditCampaign = (camp: Campaign) => {
    setEditingCampaign(camp);
    setFormTitle(camp.title);
    setFormTweetUrl(camp.tweetUrl);
    setFormRewardAmount(camp.rewardAmount);
    setFormTotalPool(camp.totalPool || '');
    setFormDescription(camp.description);
    let resolvedDuration = '24';
    if (
      typeof camp.durationHours === 'number' &&
      Number.isFinite(camp.durationHours) &&
      camp.durationHours > 0
    ) {
      resolvedDuration = String(camp.durationHours);
    } else if (camp.createdAt && camp.expiresAt) {
      const diffHours = Math.round(
        (new Date(camp.expiresAt).getTime() - new Date(camp.createdAt).getTime()) / (1000 * 60 * 60)
      );
      if (Number.isFinite(diffHours) && diffHours > 0) {
        resolvedDuration = String(diffHours);
      }
    }
    setFormDurationHours(resolvedDuration);
    setFormPinned(Boolean(camp.pinned));
    setShowCreateForm(true);
  };

  const handleCancelCampaignForm = () => {
    setShowCreateForm(false);
    setEditingCampaign(null);
    setFormTitle('');
    setFormTweetUrl('');
    setFormRewardAmount('');
    setFormTotalPool('');
    setFormDescription('');
    setFormDurationHours('24');
    setFormPinned(false);
  };

  const handleTogglePin = async (camp: Campaign) => {
    try {
      const url = `/api/admin/campaigns/${camp.id}`;
      const bodyStr = JSON.stringify({ pinned: !camp.pinned });
      const authHeaders = await getHeaders('PATCH', url, bodyStr);
      const res = await fetch(url, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders,
        },
        body: bodyStr,
      });
      const data = await res.json();
      if (data.ok) {
        onToast(camp.pinned ? 'Raid unpinned' : 'Raid pinned as priority!');
        fetchCampaigns();
      }
    } catch {
      onToast('Failed to toggle pin state', 'error');
    }
  };

  const handleToggleStatus = async (camp: Campaign) => {
    const nextStatus = camp.status === 'ACTIVE' ? 'COMPLETED' : 'ACTIVE';
    try {
      const url = `/api/admin/campaigns/${camp.id}`;
      const bodyStr = JSON.stringify({ status: nextStatus });
      const authHeaders = await getHeaders('PATCH', url, bodyStr);
      const res = await fetch(url, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders,
        },
        body: bodyStr,
      });
      const data = await res.json();
      if (data.ok) {
        onToast(`Campaign status changed to ${nextStatus}`);
        fetchCampaigns();
      }
    } catch {
      onToast('Failed to update campaign status', 'error');
    }
  };

  const handleDeleteCampaign = async (camp: Campaign) => {
    if (!confirm(`Are you sure you want to permanently delete campaign "${camp.title}"?`)) {
      return;
    }
    try {
      const url = `/api/admin/campaigns/${camp.id}`;
      const authHeaders = await getHeaders('DELETE', url, '');
      const res = await fetch(url, {
        method: 'DELETE',
        headers: authHeaders,
      });
      const data = await res.json();
      if (data.ok) {
        onToast('Campaign deleted successfully');
        if (selectedCampaignId === camp.id) {
          setSelectedCampaignId(null);
        }
        fetchCampaigns();
      }
    } catch {
      onToast('Failed to delete campaign', 'error');
    }
  };

  const handleMarkAirdropped = async (sub: CampaignSubmission) => {
    setUpdatingSubId(sub.id);
    const nextStatus = sub.status === 'AIRDROPPED' ? 'PENDING' : 'AIRDROPPED';
    try {
      const url = `/api/admin/campaigns/submissions/${sub.id}`;
      const bodyStr = JSON.stringify({
        status: nextStatus,
        airdropTx: nextStatus === 'AIRDROPPED' ? 'MANUAL_DISPATCH' : undefined,
      });
      const authHeaders = await getHeaders('PATCH', url, bodyStr);
      const res = await fetch(url, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders,
        },
        body: bodyStr,
      });
      const data = await res.json();
      if (data.ok) {
        onToast(nextStatus === 'AIRDROPPED' ? 'Marked as Airdropped ✓' : 'Reverted to Pending');
        if (selectedCampaignId) {
          fetchSubmissions(selectedCampaignId);
        }
      }
    } catch {
      onToast('Failed to update submission status', 'error');
    } finally {
      setUpdatingSubId(null);
    }
  };

  const handleCopyPendingWallets = () => {
    const pendingWallets = submissions
      .filter((s) => s.status === 'PENDING')
      .map((s) => s.walletAddress.trim())
      .filter(Boolean);

    if (pendingWallets.length === 0) {
      onToast('No pending wallets to copy', 'error');
      return;
    }

    navigator.clipboard.writeText(pendingWallets.join('\n'));
    setCopiedWallets(true);
    setTimeout(() => setCopiedWallets(false), 2000);
    onToast(`Copied ${pendingWallets.length} pending wallets to clipboard!`);
  };

  const handleCopySingleWallet = (addr: string) => {
    navigator.clipboard.writeText(addr);
    setCopiedSingleWallet(addr);
    setTimeout(() => setCopiedSingleWallet(null), 1800);
  };

  const currentCamp = campaigns.find((c) => c.id === selectedCampaignId);
  const pendingCount = submissions.filter((s) => s.status === 'PENDING').length;
  const airdroppedCount = submissions.filter((s) => s.status === 'AIRDROPPED').length;

  return (
    <div className="p-5 space-y-6">
      {/* Top action row */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-border-default">
        <div>
          <div className="font-sans text-xs font-black uppercase tracking-widest text-raid-primary flex items-center gap-2">
            <Gift className="w-4 h-4 text-raid-primary" />
            <span>X RAID CAMPAIGNS &amp; AIRDROP REWARD DESK</span>
          </div>
          <p className="font-sans text-xs text-muted mt-0.5">
            Post raid missions, verify completed user tweets, and distribute token rewards.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={fetchCampaigns}
            className="h-9 px-3.5 rounded-lg bg-surface border border-border-default hover:border-raid-primary font-sans text-xs text-muted hover:text-white cursor-pointer inline-flex items-center gap-1.5 transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>

          <button
            type="button"
            onClick={() => setShowCreateForm(!showCreateForm)}
            className="h-9 px-4 rounded-lg bg-raid-strong hover:bg-raid-primary text-white font-sans text-xs font-black uppercase cursor-pointer inline-flex items-center gap-1.5 transition-colors shadow-none"
          >
            <Plus className="w-4 h-4 stroke-[2.5]" />
            <span>{showCreateForm ? 'Hide Form' : '+ Post New Raid Campaign'}</span>
          </button>
        </div>
      </div>

      {/* CREATE CAMPAIGN FORM */}
      {showCreateForm && (
        <form
          onSubmit={handleCreateCampaign}
          className="p-5 rounded-xl bg-surface-card border border-raid-border/60 space-y-4 shadow-none"
        >
          <div className="font-sans text-xs font-extrabold text-white flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className="w-3.5 h-3.5 text-raid-primary" />
              <span>{editingCampaign ? `EDIT RAID: ${editingCampaign.title}` : 'CREATE NEW X RAID CAMPAIGN'}</span>
            </div>
            {editingCampaign && (
              <span className="px-2 py-0.5 rounded-md bg-raid-bg text-raid-text border border-raid-border text-[10px] font-mono">
                EDITING MODE
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
            <div className="md:col-span-6 space-y-1">
              <label className="block font-sans text-[11px] font-bold text-muted uppercase">
                Campaign Title *
              </label>
              <input
                type="text"
                value={formTitle}
                onChange={(e) => setFormTitle(e.target.value)}
                placeholder="e.g. X RAID: TrenchLabs v2 & $GENESIS Ecosystem Announcement"
                className="w-full h-10 px-3 rounded-lg bg-surface border border-border-default focus:border-raid-primary font-sans text-xs text-white placeholder:text-dim focus:outline-none"
                required
              />
            </div>

            <div className="md:col-span-6 space-y-1">
              <label className="block font-sans text-[11px] font-bold text-muted uppercase">
                Target X / Twitter Post URL *
              </label>
              <input
                type="url"
                value={formTweetUrl}
                onChange={(e) => setFormTweetUrl(e.target.value)}
                placeholder="https://x.com/TrenchLabsHQ/status/..."
                className="w-full h-10 px-3 rounded-lg bg-surface border border-border-default focus:border-raid-primary font-mono text-xs text-white placeholder:text-dim focus:outline-none"
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-12 gap-3">
            <div className="md:col-span-4 space-y-1">
              <label className="block font-sans text-[11px] font-bold text-muted uppercase">
                Airdrop Reward Per User *
              </label>
              <input
                type="text"
                value={formRewardAmount}
                onChange={(e) => setFormRewardAmount(e.target.value)}
                placeholder="e.g. 50,000 $GENESIS or 0.25 SOL"
                className="w-full h-10 px-3 rounded-lg bg-surface border border-border-default focus:border-raid-primary font-mono text-xs text-raid-text focus:outline-none"
                required
              />
            </div>

            <div className="md:col-span-4 space-y-1">
              <label className="block font-sans text-[11px] font-bold text-muted uppercase">
                Total Reward Pool (Optional)
              </label>
              <input
                type="text"
                value={formTotalPool}
                onChange={(e) => setFormTotalPool(e.target.value)}
                placeholder="e.g. 1,000,000 $GENESIS Pool"
                className="w-full h-10 px-3 rounded-lg bg-surface border border-border-default focus:border-raid-primary font-mono text-xs text-white focus:outline-none"
              />
            </div>

            <div className="md:col-span-4 space-y-1">
              <label className="block font-sans text-[11px] font-bold text-muted uppercase flex items-center justify-between">
                <span>Raid Duration</span>
                <span className="text-raid-primary font-mono text-[10px]">{formDurationHours}h window</span>
              </label>
              <select
                value={formDurationHours}
                onChange={(e) => setFormDurationHours(e.target.value)}
                className="w-full h-10 px-2.5 rounded-lg bg-surface border border-border-default focus:border-raid-primary font-mono text-xs text-raid-text focus:outline-none cursor-pointer"
              >
                {formDurationHours &&
                  !['12', '24', '48', '72', '168', '336'].includes(formDurationHours) && (
                    <option value={formDurationHours}>{formDurationHours} Hours (Current)</option>
                  )}
                <option value="12">12 Hours</option>
                <option value="24">24 Hours (1 Day)</option>
                <option value="48">48 Hours (2 Days)</option>
                <option value="72">72 Hours (3 Days)</option>
                <option value="168">168 Hours (7 Days)</option>
                <option value="336">336 Hours (14 Days)</option>
              </select>
            </div>
          </div>

          <div className="space-y-1">
            <label className="block font-sans text-[11px] font-bold text-muted uppercase">
              Raid Instructions / Mission Thesis
            </label>
            <input
              type="text"
              value={formDescription}
              onChange={(e) => setFormDescription(e.target.value)}
              placeholder="Like, Retweet, and Quote tweet with your bullish take on TrenchLabs..."
              className="w-full h-10 px-3 rounded-lg bg-surface border border-border-default focus:border-raid-primary font-sans text-xs text-white placeholder:text-dim focus:outline-none"
            />
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
            <label className="inline-flex items-center gap-2 font-sans text-xs font-bold text-raid-text cursor-pointer select-none">
              <input
                type="checkbox"
                checked={formPinned}
                onChange={(e) => setFormPinned(e.target.checked)}
                className="accent-raid-strong w-4 h-4 cursor-pointer"
              />
              <Pin className="w-3.5 h-3.5 text-raid-primary" />
              <span>Pin Priority Raid (Show in Pinned Priority section)</span>
            </label>

            <div className="flex items-center gap-2 justify-end">
              <button
                type="button"
                onClick={handleCancelCampaignForm}
                className="h-10 px-4 rounded-lg bg-surface border border-border-default text-xs font-sans text-muted hover:text-white cursor-pointer transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submittingCampaign}
                className="h-10 px-5 rounded-lg bg-raid-strong hover:bg-raid-primary text-white font-sans text-xs font-black uppercase cursor-pointer transition-colors shadow-none disabled:opacity-50 inline-flex items-center gap-1.5"
              >
                {submittingCampaign ? (
                  <span>Processing...</span>
                ) : editingCampaign ? (
                  <>
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Save Raid Changes</span>
                  </>
                ) : (
                  <>
                    <Plus className="w-3.5 h-3.5" />
                    <span>Publish Raid Campaign</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </form>
      )}

      {/* CAMPAIGNS LIST & SUBMISSION DESK */}
      <div className="space-y-4">
        {/* Campaign Selector / Switcher */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1">
          {campaigns.map((camp) => (
            <button
              key={camp.id}
              type="button"
              onClick={() => selectCampaign(camp.id)}
              className={`px-3.5 py-2 rounded-lg border font-sans text-xs font-bold shrink-0 transition-colors cursor-pointer inline-flex items-center gap-2 ${
                selectedCampaignId === camp.id
                  ? 'bg-raid-bg border-raid-border text-raid-text'
                  : 'bg-surface-card border-border-default text-muted hover:text-white'
              }`}
            >
              <span
                className={`w-2 h-2 rounded-full ${
                  camp.status === 'ACTIVE' ? 'bg-toxic' : 'bg-idle'
                }`}
              />
              <span className="truncate max-w-[200px]">{camp.title}</span>
              <span className="px-1.5 py-0.5 rounded-md bg-surface border border-border-default font-mono text-[10px] text-raid-primary">
                {camp.submissionsCount || 0}
              </span>
            </button>
          ))}
        </div>

        {currentCamp && (
          <div className="rounded-xl bg-surface border border-raid-border/40 overflow-hidden shadow-none">
            {/* Header: Selected Campaign Summary */}
            <div className="p-4 bg-surface-card border-b border-border-default flex flex-col md:flex-row md:items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs font-black text-raid-primary">
                    {currentCamp.rewardAmount}
                  </span>
                  <span className="text-muted">•</span>
                  <a
                    href={currentCamp.tweetUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-xs text-muted hover:text-raid-primary inline-flex items-center gap-1 transition-colors"
                  >
                    <span>View Tweet</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
                <h4 className="font-sans text-base font-extrabold text-white mt-0.5">
                  {currentCamp.title}
                </h4>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => handleTogglePin(currentCamp)}
                  className={`h-9 px-3 rounded-lg font-mono text-xs font-bold border cursor-pointer transition-colors inline-flex items-center gap-1 ${
                    currentCamp.pinned
                      ? 'bg-raid-strong text-white border-raid-border font-black'
                      : 'bg-surface border-border-default text-muted hover:text-white'
                  }`}
                  title={currentCamp.pinned ? 'Unpin Priority Raid' : 'Pin Raid as Priority'}
                >
                  <Pin className="w-3.5 h-3.5" />
                  <span>{currentCamp.pinned ? 'PINNED' : 'PIN'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleStartEditCampaign(currentCamp)}
                  className="h-9 px-3 rounded-lg font-mono text-xs font-bold border border-raid-border/60 bg-raid-bg text-raid-text hover:bg-surface-3 cursor-pointer transition-colors inline-flex items-center gap-1"
                  title="Edit Raid Campaign"
                >
                  <Pencil className="w-3.5 h-3.5" />
                  <span>EDIT RAID</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleToggleStatus(currentCamp)}
                  className={`h-9 px-3 rounded-lg font-mono text-xs font-bold border cursor-pointer transition-colors ${
                    currentCamp.status === 'ACTIVE'
                      ? 'bg-toxic-bg text-toxic border-toxic-border'
                      : 'bg-surface text-muted border-border-default'
                  }`}
                >
                  {currentCamp.status === 'ACTIVE' ? 'STATUS: ACTIVE' : 'STATUS: COMPLETED'}
                </button>

                <button
                  type="button"
                  onClick={() => handleDeleteCampaign(currentCamp)}
                  className="h-9 w-9 rounded-lg bg-surface border border-border-default hover:border-danger text-muted hover:text-danger flex items-center justify-center cursor-pointer transition-colors"
                  title="Delete Campaign"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Campaign Metrics & Batch Action Bar */}
            <div className="p-4 bg-surface flex flex-wrap items-center justify-between gap-3 border-b border-border-default">
              <div className="flex items-center gap-4 text-xs font-mono">
                <div className="text-white">
                  Total Submissions: <strong className="text-raid-primary">{submissions.length}</strong>
                </div>
                <div className="text-amber">
                  Pending Airdrop: <strong>{pendingCount}</strong>
                </div>
                <div className="text-toxic">
                  Airdropped: <strong>{airdroppedCount}</strong>
                </div>
              </div>

              <button
                type="button"
                onClick={handleCopyPendingWallets}
                className="h-9 px-3.5 rounded-lg bg-surface-card hover:bg-surface-3 border border-raid-border/60 text-raid-text font-sans text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer transition-colors"
                title="Copies list of all pending Solana wallet addresses separated by newline"
              >
                {copiedWallets ? (
                  <Check className="w-3.5 h-3.5 text-toxic" />
                ) : (
                  <Copy className="w-3.5 h-3.5 text-raid-primary" />
                )}
                <span>
                  {copiedWallets ? 'Copied to Clipboard!' : `Copy All Unpaid Wallets (${pendingCount})`}
                </span>
              </button>
            </div>

            {/* Submissions Table */}
            <div className="overflow-x-auto">
              {loadingSubmissions ? (
                <div className="py-12 text-center text-xs font-mono text-muted">
                  Loading submissions...
                </div>
              ) : submissionsError ? (
                <div className="py-12 px-4 text-center space-y-3">
                  <div className="inline-flex items-center gap-2 text-xs font-mono text-red-400">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>{submissionsError}</span>
                  </div>
                  <div>
                    <button
                      type="button"
                      onClick={() => selectedCampaignId && void fetchSubmissions(selectedCampaignId)}
                      className="px-3 py-1.5 rounded-lg bg-surface border border-border-default hover:border-raid-primary/50 text-xs font-mono text-foreground transition-colors cursor-pointer"
                    >
                      Retry
                    </button>
                  </div>
                </div>
              ) : submissions.length === 0 ? (
                <div className="py-12 text-center text-xs font-mono text-muted">
                  No user submissions yet for this campaign.
                </div>
              ) : (
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-border-default bg-surface-card font-sans text-[11px] text-muted uppercase">
                      <th className="py-3 px-4">User Wallet</th>
                      <th className="py-3 px-4">X Handle</th>
                      <th className="py-3 px-4">Retweet Proof</th>
                      <th className="py-3 px-4">Submitted At</th>
                      <th className="py-3 px-4">Status</th>
                      <th className="py-3 px-4 text-right">Airdrop Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border-default font-mono text-xs">
                    {submissions.map((sub) => (
                      <tr key={sub.id} className="hover:bg-surface-card transition-colors">
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-1.5">
                            <span className="font-semibold text-white">
                              {sub.walletAddress.slice(0, 6)}...{sub.walletAddress.slice(-4)}
                            </span>
                            <button
                              type="button"
                              onClick={() => handleCopySingleWallet(sub.walletAddress)}
                              className="p-1 rounded-md hover:bg-surface-card text-muted hover:text-raid-primary transition-colors"
                              title="Copy wallet"
                            >
                              {copiedSingleWallet === sub.walletAddress ? (
                                <Check className="w-3 h-3 text-toxic" />
                              ) : (
                                <Copy className="w-3 h-3" />
                              )}
                            </button>
                            <a
                              href={`https://solscan.io/account/${sub.walletAddress}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-muted hover:text-raid-primary transition-colors"
                              title="View on Solscan"
                            >
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          </div>
                        </td>

                        <td className="py-3 px-4">
                          <a
                            href={`https://x.com/${sub.xHandle.replace(/^@/, '')}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-raid-primary hover:underline font-bold inline-flex items-center gap-1"
                          >
                            <span>{sub.xHandle}</span>
                            <ExternalLink className="w-2.5 h-2.5 text-muted" />
                          </a>
                        </td>

                        <td className="py-3 px-4">
                          <a
                            href={sub.xRetweetLink}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="h-8 px-2.5 rounded-md bg-surface-card hover:bg-surface-3 border border-border-default text-white hover:text-raid-primary inline-flex items-center gap-1 transition-colors"
                          >
                            <span>Inspect Retweet ↗</span>
                          </a>
                        </td>

                        <td className="py-3 px-4 text-muted text-[11px]">
                          {new Date(sub.submittedAt).toLocaleString()}
                        </td>

                        <td className="py-3 px-4">
                          <span
                            className={`px-2.5 py-1 rounded-md text-[10px] font-black uppercase inline-flex items-center gap-1 ${
                              sub.status === 'AIRDROPPED'
                                ? 'bg-toxic-bg text-toxic border border-toxic-border'
                                : 'bg-amber/15 text-amber border border-amber/40'
                            }`}
                          >
                            {sub.status === 'AIRDROPPED' ? (
                              <>
                                <CheckCircle2 className="w-3 h-3" />
                                <span>AIRDROPPED</span>
                              </>
                            ) : (
                              <>
                                <Clock className="w-3 h-3" />
                                <span>PENDING</span>
                              </>
                            )}
                          </span>
                        </td>

                        <td className="py-3 px-4 text-right">
                          <button
                            type="button"
                            disabled={updatingSubId === sub.id}
                            onClick={() => handleMarkAirdropped(sub)}
                            className={`h-8 px-3 rounded-md text-[11px] font-sans font-bold cursor-pointer transition-colors ${
                              sub.status === 'AIRDROPPED'
                                ? 'bg-surface-card hover:bg-surface-3 text-muted hover:text-white border border-border-default'
                                : 'bg-raid-strong hover:bg-raid-primary text-white shadow-none'
                            }`}
                          >
                            {sub.status === 'AIRDROPPED' ? 'Revert to Pending' : 'Mark Airdropped ✓'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
