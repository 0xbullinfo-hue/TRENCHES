'use client';

import React, { useCallback, useEffect, useState } from 'react';
import type { Campaign, CampaignSubmission } from '@/lib/types';
import {
  Plus,
  Trash2,
  CheckCircle2,
  Clock,
  Sparkles,
  ExternalLink,
  Copy,
  Check,
  RefreshCw,
  Gift,
  Pencil,
  Pin,
} from 'lucide-react';

interface AdminCampaignManagerProps {
  onToast: (msg: string) => void;
  getAdminHeaders?: (method: string, path: string, body: string) => Promise<Record<string, string>>;
}

export const AdminCampaignManager: React.FC<AdminCampaignManagerProps> = ({
  onToast,
  getAdminHeaders,
}) => {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editingCampaign, setEditingCampaign] = useState<Campaign | null>(null);
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null);
  const [submissions, setSubmissions] = useState<CampaignSubmission[]>([]);
  const [loadingSubmissions, setLoadingSubmissions] = useState(false);

  // Create Campaign Form State
  const [formTitle, setFormTitle] = useState('');
  const [formTweetUrl, setFormTweetUrl] = useState('');
  const [formRewardAmount, setFormRewardAmount] = useState('50,000 $GENESIS');
  const [formTotalPool, setFormTotalPool] = useState('1,000,000 $GENESIS');
  const [formDescription, setFormDescription] = useState(
    'Like, Retweet, and Quote tweet with your bullish take on TrenchLabs. Submit your proof below to receive the verified airdrop.'
  );
  const [formPinned, setFormPinned] = useState(true);
  const [submittingCampaign, setSubmittingCampaign] = useState(false);

  // Submissions management
  const [updatingSubId, setUpdatingSubId] = useState<string | null>(null);
  const [copiedWallets, setCopiedWallets] = useState(false);
  const [copiedSingleWallet, setCopiedSingleWallet] = useState<string | null>(null);

  const fetchCampaigns = useCallback(async () => {
    try {
      const res = await fetch('/api/campaigns');
      const json = await res.json();
      if (res.ok && json.ok && Array.isArray(json.campaigns)) {
        setCampaigns(json.campaigns);
        setSelectedCampaignId((prev) => prev || (json.campaigns.length > 0 ? json.campaigns[0].id : null));
      }
    } catch (err) {
      console.error('[AdminCampaignManager] fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchSubmissions = useCallback(
    async (campId: string) => {
      setLoadingSubmissions(true);
      try {
        let headers: Record<string, string> = {};
        if (getAdminHeaders) {
          try {
            headers = await getAdminHeaders('GET', `/api/admin/campaigns/${campId}/submissions`, '');
          } catch {
            // fallback
          }
        }
        const res = await fetch(`/api/admin/campaigns/${campId}/submissions`, { headers });
        const json = await res.json();
        if (res.ok && json.ok && Array.isArray(json.submissions)) {
          setSubmissions(json.submissions);
        }
      } catch (err) {
        console.error('[AdminCampaignManager] fetch submissions error:', err);
      } finally {
        setLoadingSubmissions(false);
      }
    },
    [getAdminHeaders]
  );

  useEffect(() => {
    let active = true;
    const run = async () => {
      try {
        const res = await fetch('/api/campaigns');
        const json = await res.json();
        if (active && res.ok && json.ok && Array.isArray(json.campaigns)) {
          setCampaigns(json.campaigns);
          setSelectedCampaignId((prev) => prev || (json.campaigns.length > 0 ? json.campaigns[0].id : null));
        }
      } catch (err) {
        console.error('[AdminCampaignManager] fetch error:', err);
      } finally {
        if (active) setLoading(false);
      }
    };
    run();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (selectedCampaignId) {
      let active = true;
      const run = async () => {
        setLoadingSubmissions(true);
        try {
          let headers: Record<string, string> = {};
          if (getAdminHeaders) {
            try {
              headers = await getAdminHeaders('GET', `/api/admin/campaigns/${selectedCampaignId}/submissions`, '');
            } catch {
              // fallback
            }
          }
          const res = await fetch(`/api/admin/campaigns/${selectedCampaignId}/submissions`, { headers });
          const json = await res.json();
          if (active && res.ok && json.ok && Array.isArray(json.submissions)) {
            setSubmissions(json.submissions);
          }
        } catch (err) {
          console.error('[AdminCampaignManager] fetch submissions error:', err);
        } finally {
          if (active) setLoadingSubmissions(false);
        }
      };
      run();
      return () => {
        active = false;
      };
    }
  }, [selectedCampaignId, getAdminHeaders]);

  const handleStartEditCampaign = (camp: Campaign) => {
    setEditingCampaign(camp);
    setFormTitle(camp.title);
    setFormTweetUrl(camp.tweetUrl);
    setFormRewardAmount(camp.rewardAmount);
    setFormTotalPool(camp.totalPool || '1,000,000 $GENESIS');
    setFormDescription(camp.description);
    setFormPinned(camp.pinned ?? true);
    setShowCreateForm(true);
    window.scrollTo({ top: 300, behavior: 'smooth' });
  };

  const handleCancelCampaignForm = () => {
    setShowCreateForm(false);
    setEditingCampaign(null);
    setFormTitle('');
    setFormTweetUrl('');
    setFormRewardAmount('50,000 $GENESIS');
    setFormTotalPool('1,000,000 $GENESIS');
    setFormDescription(
      'Like, Retweet, and Quote tweet with your bullish take on TrenchLabs. Submit your proof below to receive the verified airdrop.'
    );
    setFormPinned(true);
  };

  const handleCreateCampaign = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formTitle.trim() || !formTweetUrl.trim() || !formRewardAmount.trim()) {
      alert('Please fill out all required fields (Title, Tweet URL, Reward Amount).');
      return;
    }

    setSubmittingCampaign(true);
    try {
      const payload = {
        title: formTitle.trim(),
        description: formDescription.trim(),
        tweetUrl: formTweetUrl.trim(),
        rewardAmount: formRewardAmount.trim(),
        totalPool: formTotalPool.trim() || undefined,
        targetActions: ['Like', 'Retweet', 'Quote with $GENESIS'],
        pinned: formPinned,
      };

      const bodyStr = JSON.stringify(payload);
      let headers: Record<string, string> = { 'Content-Type': 'application/json' };
      const method = editingCampaign ? 'PATCH' : 'POST';
      const endpoint = editingCampaign ? `/api/campaigns/${editingCampaign.id}` : '/api/campaigns';

      if (getAdminHeaders) {
        try {
          headers = await getAdminHeaders(method, endpoint, bodyStr);
        } catch {
          // fallback to default headers
        }
      }

      const res = await fetch(endpoint, {
        method,
        headers,
        body: bodyStr,
      });

      const json = await res.json();
      if (!res.ok || !json.ok) {
        throw new Error(json.error || `Failed to ${editingCampaign ? 'update' : 'create'} campaign`);
      }

      onToast(`Campaign "${payload.title}" ${editingCampaign ? 'updated' : 'created'} successfully!`);
      handleCancelCampaignForm();
      fetchCampaigns();
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setSubmittingCampaign(false);
    }
  };

  const handleToggleStatus = async (camp: Campaign) => {
    const nextStatus = camp.status === 'ACTIVE' ? 'COMPLETED' : 'ACTIVE';
    try {
      const bodyStr = JSON.stringify({ status: nextStatus });
      let headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (getAdminHeaders) {
        try {
          headers = await getAdminHeaders('PATCH', `/api/campaigns/${camp.id}`, bodyStr);
        } catch {
          // fallback
        }
      }

      const res = await fetch(`/api/campaigns/${camp.id}`, {
        method: 'PATCH',
        headers,
        body: bodyStr,
      });

      if (res.ok) {
        onToast(`Campaign status updated to ${nextStatus}`);
        fetchCampaigns();
      }
    } catch (err) {
      alert((err as Error).message);
    }
  };

  const handleTogglePin = async (camp: Campaign) => {
    const nextPinned = !camp.pinned;
    try {
      const bodyStr = JSON.stringify({ pinned: nextPinned });
      let headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (getAdminHeaders) {
        try {
          headers = await getAdminHeaders('PATCH', `/api/campaigns/${camp.id}`, bodyStr);
        } catch {
          // fallback
        }
      }

      const res = await fetch(`/api/campaigns/${camp.id}`, {
        method: 'PATCH',
        headers,
        body: bodyStr,
      });

      if (res.ok) {
        onToast(`${nextPinned ? 'Pinned' : 'Unpinned'} campaign "${camp.title}"`);
        fetchCampaigns();
      }
    } catch (err) {
      alert((err as Error).message);
    }
  };

  const handleDeleteCampaign = async (camp: Campaign) => {
    if (!window.confirm(`Are you sure you want to delete campaign "${camp.title}"?`)) {
      return;
    }

    try {
      let headers: Record<string, string> = {};
      if (getAdminHeaders) {
        try {
          headers = await getAdminHeaders('DELETE', `/api/campaigns/${camp.id}`, '');
        } catch {
          // fallback
        }
      }

      const res = await fetch(`/api/campaigns/${camp.id}`, {
        method: 'DELETE',
        headers,
      });

      if (res.ok) {
        onToast(`Campaign "${camp.title}" deleted.`);
        fetchCampaigns();
      }
    } catch (err) {
      alert((err as Error).message);
    }
  };

  const handleMarkAirdropped = async (sub: CampaignSubmission) => {
    const nextStatus = sub.status === 'AIRDROPPED' ? 'PENDING' : 'AIRDROPPED';
    let txHash: string | undefined = undefined;
    if (nextStatus === 'AIRDROPPED') {
      const inputTx = window.prompt(
        `Mark airdrop sent to ${sub.walletAddress.slice(0, 6)}...${sub.walletAddress.slice(-4)} (${sub.xHandle})\nOptional: enter Solana transaction hash/signature:`,
        ''
      );
      if (inputTx === null) return; // cancelled
      if (inputTx.trim()) txHash = inputTx.trim();
    }

    setUpdatingSubId(sub.id);
    try {
      const bodyStr = JSON.stringify({ status: nextStatus, airdropTx: txHash });
      let headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (getAdminHeaders) {
        try {
          headers = await getAdminHeaders(
            'PATCH',
            `/api/admin/campaigns/submissions/${sub.id}`,
            bodyStr
          );
        } catch {
          // fallback
        }
      }

      const res = await fetch(`/api/admin/campaigns/submissions/${sub.id}`, {
        method: 'PATCH',
        headers,
        body: bodyStr,
      });

      if (res.ok) {
        onToast(
          nextStatus === 'AIRDROPPED'
            ? `Marked ${sub.xHandle} as Airdropped ✓`
            : `Reverted ${sub.xHandle} to Pending`
        );
        if (selectedCampaignId) {
          fetchSubmissions(selectedCampaignId);
          fetchCampaigns();
        }
      }
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setUpdatingSubId(null);
    }
  };

  const handleCopyPendingWallets = () => {
    const pendingSubs = submissions.filter((s) => s.status === 'PENDING');
    if (pendingSubs.length === 0) {
      alert('No pending submissions to copy.');
      return;
    }
    const walletList = pendingSubs.map((s) => s.walletAddress).join('\n');
    navigator.clipboard.writeText(walletList);
    setCopiedWallets(true);
    onToast(`Copied ${pendingSubs.length} pending Solana wallet addresses!`);
    setTimeout(() => setCopiedWallets(false), 2000);
  };

  const handleCopySingleWallet = (wallet: string) => {
    navigator.clipboard.writeText(wallet);
    setCopiedSingleWallet(wallet);
    setTimeout(() => setCopiedSingleWallet(null), 1500);
  };

  const currentCamp = campaigns.find((c) => c.id === selectedCampaignId);
  const pendingCount = submissions.filter((s) => s.status === 'PENDING').length;
  const airdroppedCount = submissions.filter((s) => s.status === 'AIRDROPPED').length;

  return (
    <div className="p-5 space-y-6">
      {/* Top action row */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-line">
        <div>
          <div className="font-sans text-xs font-black uppercase tracking-widest text-purple-400 flex items-center gap-2">
            <Gift className="w-4 h-4 text-purple-400" />
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
            className="px-3 py-1.5 rounded bg-surface border border-line hover:border-purple-500 font-sans text-xs text-muted hover:text-white cursor-pointer inline-flex items-center gap-1.5"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>

          <button
            type="button"
            onClick={() => setShowCreateForm(!showCreateForm)}
            className="px-3.5 py-1.5 rounded bg-purple-600 hover:bg-purple-500 text-white font-sans text-xs font-black uppercase cursor-pointer inline-flex items-center gap-1.5 transition-colors shadow-sm"
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
          className="p-4 rounded-xl bg-surface-card border border-purple-500/40 space-y-3"
        >
          <div className="font-sans text-xs font-extrabold text-white flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className="w-3.5 h-3.5 text-purple-400" />
              <span>{editingCampaign ? `EDIT RAID: ${editingCampaign.title}` : 'CREATE NEW X RAID CAMPAIGN'}</span>
            </div>
            {editingCampaign && (
              <span className="px-2 py-0.5 rounded bg-purple-500/20 text-purple-300 border border-purple-500/40 text-[10px] font-mono">
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
                className="w-full h-9 px-3 rounded bg-surface border border-line focus:border-purple-400 font-sans text-xs text-white placeholder:text-neutral-500 focus:outline-none"
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
                className="w-full h-9 px-3 rounded bg-surface border border-line focus:border-purple-400 font-mono text-xs text-white placeholder:text-neutral-500 focus:outline-none"
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-12 gap-3">
            <div className="md:col-span-6 space-y-1">
              <label className="block font-sans text-[11px] font-bold text-muted uppercase">
                Airdrop Reward Per User *
              </label>
              <input
                type="text"
                value={formRewardAmount}
                onChange={(e) => setFormRewardAmount(e.target.value)}
                placeholder="e.g. 50,000 $GENESIS or 0.25 SOL"
                className="w-full h-9 px-3 rounded bg-surface border border-line focus:border-purple-400 font-mono text-xs text-purple-300 focus:outline-none"
                required
              />
            </div>

            <div className="md:col-span-6 space-y-1">
              <label className="block font-sans text-[11px] font-bold text-muted uppercase">
                Total Reward Pool (Optional)
              </label>
              <input
                type="text"
                value={formTotalPool}
                onChange={(e) => setFormTotalPool(e.target.value)}
                placeholder="e.g. 1,000,000 $GENESIS Pool"
                className="w-full h-9 px-3 rounded bg-surface border border-line focus:border-purple-400 font-mono text-xs text-white focus:outline-none"
              />
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
              className="w-full h-9 px-3 rounded bg-surface border border-line focus:border-purple-400 font-sans text-xs text-white placeholder:text-neutral-500 focus:outline-none"
            />
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
            <label className="inline-flex items-center gap-2 font-sans text-xs font-bold text-purple-300 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={formPinned}
                onChange={(e) => setFormPinned(e.target.checked)}
                className="accent-purple-500 w-4 h-4 cursor-pointer"
              />
              <Pin className="w-3.5 h-3.5 text-purple-400" />
              <span>Pin Priority Raid (Show in Pinned Priority section)</span>
            </label>

            <div className="flex items-center gap-2 justify-end">
              <button
                type="button"
                onClick={handleCancelCampaignForm}
                className="px-4 py-2 rounded bg-surface border border-line text-xs font-sans text-muted hover:text-white cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submittingCampaign}
                className="px-5 py-2 rounded bg-purple-600 hover:bg-purple-500 text-white font-sans text-xs font-black uppercase cursor-pointer transition-colors shadow-sm disabled:opacity-50 inline-flex items-center gap-1.5"
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
              onClick={() => setSelectedCampaignId(camp.id)}
              className={`px-3.5 py-2 rounded-lg border font-sans text-xs font-bold shrink-0 transition-colors cursor-pointer inline-flex items-center gap-2 ${
                selectedCampaignId === camp.id
                  ? 'bg-purple-500/20 border-purple-500 text-white'
                  : 'bg-surface-card border-line text-muted hover:text-white'
              }`}
            >
              <span
                className={`w-2 h-2 rounded-full ${
                  camp.status === 'ACTIVE' ? 'bg-emerald-400' : 'bg-neutral-500'
                }`}
              />
              <span className="truncate max-w-[200px]">{camp.title}</span>
              <span className="px-1.5 py-0.2 rounded bg-surface border border-line font-mono text-[10px] text-purple-300">
                {camp.submissionsCount || 0}
              </span>
            </button>
          ))}
        </div>

        {currentCamp && (
          <div className="rounded-xl bg-surface border border-purple-500/30 overflow-hidden shadow-sm">
            {/* Header: Selected Campaign Summary */}
            <div className="p-4 bg-surface-card border-b border-line flex flex-col md:flex-row md:items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs font-black text-purple-400">
                    {currentCamp.rewardAmount}
                  </span>
                  <span className="text-muted">•</span>
                  <a
                    href={currentCamp.tweetUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-xs text-muted hover:text-purple-300 inline-flex items-center gap-1"
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
                  className={`px-3 py-1.5 rounded font-mono text-xs font-bold border cursor-pointer transition-colors inline-flex items-center gap-1 ${
                    currentCamp.pinned
                      ? 'bg-purple-600 text-white border-purple-500 font-black shadow-sm'
                      : 'bg-surface border-line text-muted hover:text-white'
                  }`}
                  title={currentCamp.pinned ? 'Unpin Priority Raid' : 'Pin Raid as Priority'}
                >
                  <Pin className="w-3.5 h-3.5" />
                  <span>{currentCamp.pinned ? 'PINNED' : 'PIN'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleStartEditCampaign(currentCamp)}
                  className="px-3 py-1.5 rounded font-mono text-xs font-bold border border-purple-500/40 bg-purple-500/10 text-purple-300 hover:bg-purple-500/20 cursor-pointer transition-colors inline-flex items-center gap-1"
                  title="Edit Raid Campaign"
                >
                  <Pencil className="w-3.5 h-3.5" />
                  <span>EDIT RAID</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleToggleStatus(currentCamp)}
                  className={`px-3 py-1.5 rounded font-mono text-xs font-bold border cursor-pointer transition-colors ${
                    currentCamp.status === 'ACTIVE'
                      ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40'
                      : 'bg-neutral-800 text-neutral-400 border-neutral-700'
                  }`}
                >
                  {currentCamp.status === 'ACTIVE' ? 'STATUS: ACTIVE' : 'STATUS: COMPLETED'}
                </button>

                <button
                  type="button"
                  onClick={() => handleDeleteCampaign(currentCamp)}
                  className="p-1.5 rounded bg-surface border border-line hover:border-danger text-muted hover:text-danger cursor-pointer"
                  title="Delete Campaign"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Campaign Metrics & Batch Action Bar */}
            <div className="p-4 bg-surface flex flex-wrap items-center justify-between gap-3 border-b border-line">
              <div className="flex items-center gap-4 text-xs font-mono">
                <div className="text-white">
                  Total Submissions: <strong className="text-purple-300">{submissions.length}</strong>
                </div>
                <div className="text-amber-400">
                  Pending Airdrop: <strong>{pendingCount}</strong>
                </div>
                <div className="text-emerald-400">
                  Airdropped: <strong>{airdroppedCount}</strong>
                </div>
              </div>

              <button
                type="button"
                onClick={handleCopyPendingWallets}
                className="px-3.5 py-1.5 rounded bg-surface-card hover:bg-surface-3 border border-purple-500/50 text-purple-300 font-sans text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer transition-colors"
                title="Copies list of all pending Solana wallet addresses separated by newline"
              >
                {copiedWallets ? (
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                ) : (
                  <Copy className="w-3.5 h-3.5 text-purple-400" />
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
              ) : submissions.length === 0 ? (
                <div className="py-12 text-center text-xs font-mono text-muted">
                  No user submissions yet for this campaign.
                </div>
              ) : (
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-line bg-surface-card font-sans text-[11px] text-muted uppercase">
                      <th className="py-3 px-4">User Wallet</th>
                      <th className="py-3 px-4">X Handle</th>
                      <th className="py-3 px-4">Retweet Proof</th>
                      <th className="py-3 px-4">Submitted At</th>
                      <th className="py-3 px-4">Status</th>
                      <th className="py-3 px-4 text-right">Airdrop Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line font-mono text-xs">
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
                              className="p-1 rounded hover:bg-surface-card text-muted hover:text-purple-300"
                              title="Copy wallet"
                            >
                              {copiedSingleWallet === sub.walletAddress ? (
                                <Check className="w-3 h-3 text-emerald-400" />
                              ) : (
                                <Copy className="w-3 h-3" />
                              )}
                            </button>
                            <a
                              href={`https://solscan.io/account/${sub.walletAddress}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-muted hover:text-purple-300"
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
                            className="text-purple-300 hover:underline font-bold inline-flex items-center gap-1"
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
                            className="px-2 py-0.5 rounded bg-surface-card hover:bg-surface-3 border border-line text-white hover:text-purple-300 inline-flex items-center gap-1"
                          >
                            <span>Inspect Retweet ↗</span>
                          </a>
                        </td>

                        <td className="py-3 px-4 text-muted text-[11px]">
                          {new Date(sub.submittedAt).toLocaleString()}
                        </td>

                        <td className="py-3 px-4">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-black uppercase inline-flex items-center gap-1 ${
                              sub.status === 'AIRDROPPED'
                                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                                : 'bg-amber-500/20 text-amber-400 border border-amber-500/40'
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
                            className={`px-2.5 py-1 rounded text-[11px] font-sans font-bold cursor-pointer transition-colors ${
                              sub.status === 'AIRDROPPED'
                                ? 'bg-surface-card hover:bg-neutral-800 text-muted hover:text-white border border-line'
                                : 'bg-purple-600 hover:bg-purple-500 text-white shadow-sm'
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
