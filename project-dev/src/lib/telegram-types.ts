export type UserTier = 'free' | 'member' | 'pro' | 'admin' | 'unknown';

export type EntitlementResult = {
  tier: UserTier;
  baseTier: 'free' | 'member' | 'pro' | 'unknown';
  isAdmin: boolean;
  wallet: string;
  verifiedAt: string | null;
  reason?: string;
};

export type TelegramIdentityStatus =
  | 'not_connected'
  | 'pending'
  | 'connected'
  | 'blocked'
  | 'disconnected';

export type TelegramIdentity = {
  wallet: string;
  telegramUserId: string | null;
  telegramChatId: string | null;
  identityStatus: TelegramIdentityStatus;
};

export type CommunityTier = 'member' | 'pro';

export type GroupStatus =
  | 'not_joined'
  | 'invite_pending'
  | 'joined'
  | 'left'
  | 'kicked'
  | 'revoked'
  | 'mismatch';

export type GroupAccess = {
  wallet: string;
  telegramUserId: string | null;
  tier: UserTier;
  groupStatus: GroupStatus;
  groupId: string | null;
  verifiedAt: string | null;
};

export type NotificationStatus =
  | 'disabled'
  | 'pending'
  | 'enabled'
  | 'blocked';

export type TelegramNotifications = {
  wallet: string;
  telegramChatId: string | null;
  status: NotificationStatus;
  updatedAt: string | null;
};

export type VerificationSessionStatus =
  | 'pending'
  | 'processing'
  | 'completed'
  | 'expired'
  | 'retryable_failed'
  | 'failed';

export type WebhookEventStatus =
  | 'received'
  | 'processing'
  | 'completed'
  | 'retryable_failed'
  | 'permanently_failed';

export type TelegramHistoricalRevocation = {
  at: string;
  reason: string;
  group_id: string | null;
};

export type TelegramMemberRecord = {
  id: string;
  wallet: string;
  wallet_address: string;
  telegram_user_id: number | null;
  telegram_chat_id: string | null;
  entitlement_tier: UserTier;
  tier: CommunityTier;
  identity_status: Exclude<TelegramIdentityStatus, 'not_connected'>;
  group_status: GroupStatus;
  group_id: string | null;
  actual_group_id?: string | null;
  actual_group_tier?: CommunityTier | null;
  in_group: boolean;
  notification_status: NotificationStatus;
  notification_preference?: 'enabled' | 'disabled';
  notification_entitlement_allowed?: boolean;
  verified_at: string | null;
  invite_created_at: string | null;
  invite_expires_at: string | null;
  invite_link_hash: string | null;
  /** Internal server-only storage for active single-use invite reuse; never exposed to clients or logs. */
  pending_invite_link?: string | null;
  joined_at: string | null;
  revoked_at: string | null;
  revoked_reason: string | null;
  historical_revocations?: TelegramHistoricalRevocation[];
  reconciliation_required?: boolean;
  reconciliation_reason?: string | null;
  reconciliation_attempt_count?: number;
  next_reconciliation_at?: number | null;
  entitlement_unknown_since: string | null;
  last_error: string | null;
  last_synced_at: string;
  created_at: string;
  updated_at: string;
};

export type TelegramStatusResult = {
  walletConnected: boolean;
  entitlement: {
    tier: UserTier;
    status: 'verified' | 'unverified' | 'unknown';
  };
  identity: {
    status: TelegramIdentityStatus;
  };
  community: {
    eligibleCommunity: CommunityTier | null;
    actualGroup: CommunityTier | null;
    membershipStatus:
      | 'joined'
      | 'invite_pending'
      | 'left'
      | 'kicked'
      | 'not_joined'
      | 'revoked'
      | 'mismatch'
      | 'unknown';
  };
  notifications: {
    preference: 'enabled' | 'disabled';
    entitlementAllowed: boolean;
    effectiveStatus: 'enabled' | 'disabled';
  };
};

export type VerificationStatusResponse = {
  ok: boolean;

  entitlement: {
    tier: UserTier;
    verified: boolean;
    checkedAt: string | null;
    reason?: string;
  };

  telegram: {
    identity: {
      status: TelegramIdentityStatus;
    };
    community: {
      tier: CommunityTier | null;
      status: GroupStatus;
      joinedAt: string | null;
      eligibleCommunity?: CommunityTier | null;
      actualGroup?: CommunityTier | null;
    };
    notifications: {
      status: NotificationStatus;
      preference?: 'enabled' | 'disabled';
      entitlementAllowed?: boolean;
    };
    /** Legacy compatibility summary fields; connected reflects confirmed active community join matching entitlement. */
    connected: boolean;
    connected_tier: CommunityTier | null;
    connected_at: string | null;
  };

  actions: {
    canConnect: boolean;
    canJoinCommunity: boolean;
    canEnableNotifications: boolean;
  };

  /** Legacy top-level compatibility fields */
  wallet: string;
  tier: 'free' | 'member' | 'pro' | 'unknown';
  can_connect: boolean;
  target_tier: CommunityTier | null;
};
