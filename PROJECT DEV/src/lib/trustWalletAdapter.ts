'use client';

import {
  BaseMessageSignerWalletAdapter,
  isIosAndRedirectable,
  isVersionedTransaction,
  scopePollingDetectionStrategy,
   SendTransactionOptions,
  WalletAccountError,
  WalletConnectionError,
  WalletDisconnectedError,
  WalletDisconnectionError,
  WalletError,
  WalletNotConnectedError,
  WalletNotReadyError,
  WalletPublicKeyError,
  WalletReadyState,
  WalletSendTransactionError,
  WalletSignMessageError,
  WalletSignTransactionError,
  WalletName,
} from '@solana/wallet-adapter-base';
import {
  Connection,
  PublicKey,
  SendOptions,
  Transaction,
  TransactionSignature,
  TransactionVersion,
  VersionedTransaction,
} from '@solana/web3.js';

interface TrustWalletSolanaProvider {
  isTrust?: boolean;
  isTrustWallet?: boolean;
  isConnected?: boolean;
  publicKey?: { toBytes(): Uint8Array; toBase58?(): string } | null;
  connect(options?: { onlyIfTrusted?: boolean }): Promise<{ publicKey?: { toBytes(): Uint8Array } } | void>;
  disconnect(): Promise<void>;
  signTransaction<T extends Transaction | VersionedTransaction>(transaction: T): Promise<T>;
  signAllTransactions<T extends Transaction | VersionedTransaction>(transactions: T[]): Promise<T[]>;
  signAndSendTransaction?(
    transaction: Transaction | VersionedTransaction,
    options?: SendOptions
  ): Promise<{ signature: TransactionSignature }>;
  signMessage(message: Uint8Array): Promise<{ signature: Uint8Array } | Uint8Array>;
  on?(event: string, listener: (...args: unknown[]) => void): void;
  off?(event: string, listener: (...args: unknown[]) => void): void;
  removeListener?(event: string, listener: (...args: unknown[]) => void): void;
}

interface TrustWalletWindow extends Window {
  trustwallet?: {
    solana?: TrustWalletSolanaProvider;
  };
  trustWallet?: {
    solana?: TrustWalletSolanaProvider;
  };
  solana?: TrustWalletSolanaProvider;
}

function getTrustWalletProvider(): TrustWalletSolanaProvider | null {
  if (typeof window === 'undefined') return null;
  const win = window as unknown as TrustWalletWindow;
  if (win.trustwallet?.solana) return win.trustwallet.solana;
  if (win.trustWallet?.solana) return win.trustWallet.solana;
  if (win.solana && (win.solana.isTrust || win.solana.isTrustWallet)) return win.solana;
  return null;
}

function extractPublicKey(rawKey: unknown): PublicKey {
  if (rawKey instanceof PublicKey) return rawKey;
  if (rawKey && typeof (rawKey as { toBytes?: () => Uint8Array }).toBytes === 'function') {
    return new PublicKey((rawKey as { toBytes: () => Uint8Array }).toBytes());
  }
  if (rawKey && typeof (rawKey as { toBase58?: () => string }).toBase58 === 'function') {
    return new PublicKey((rawKey as { toBase58: () => string }).toBase58());
  }
  if (typeof rawKey === 'string') {
    return new PublicKey(rawKey);
  }
  throw new Error('Invalid public key returned by Trust Wallet');
}

export const TrustWalletName = 'Trust Wallet' as WalletName<'Trust Wallet'>;

const TRUST_WALLET_ICON =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none">
      <rect width="64" height="64" rx="14" fill="#0500FF"/>
      <path d="M32 12C38.4 17.3 46.2 17.8 49 17.8C49 34.6 45.2 44.5 32 52C18.8 44.5 15 34.6 15 17.8C17.8 17.8 25.6 17.3 32 12Z" stroke="#00F5A0" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`
  );

export class TrustWalletAdapter extends BaseMessageSignerWalletAdapter {
  name = TrustWalletName;
  url = 'https://trustwallet.com/browser-extension';
  icon = TRUST_WALLET_ICON;
  supportedTransactionVersions: ReadonlySet<TransactionVersion> = new Set(['legacy', 0]);

  private _connecting = false;
  private _wallet: TrustWalletSolanaProvider | null = null;
  private _publicKey: PublicKey | null = null;
  private _readyState: WalletReadyState =
    typeof window === 'undefined' || typeof document === 'undefined'
      ? WalletReadyState.Unsupported
      : WalletReadyState.NotDetected;

  constructor() {
    super();
    if (this._readyState !== WalletReadyState.Unsupported) {
      if (isIosAndRedirectable()) {
        this._readyState = WalletReadyState.Loadable;
        this.emit('readyStateChange', this._readyState);
      } else {
        scopePollingDetectionStrategy(() => {
          if (getTrustWalletProvider()) {
            this._readyState = WalletReadyState.Installed;
            this.emit('readyStateChange', this._readyState);
            return true;
          }
          return false;
        });
      }
    }
  }

  get publicKey(): PublicKey | null {
    return this._publicKey;
  }

  get connecting(): boolean {
    return this._connecting;
  }

  get readyState(): WalletReadyState {
    return this._readyState;
  }

  private _disconnected = () => {
    const wallet = this._wallet;
    if (wallet) {
      wallet.off?.('disconnect', this._disconnected);
      wallet.removeListener?.('disconnect', this._disconnected);
      wallet.off?.('accountChanged', this._accountChanged);
      wallet.removeListener?.('accountChanged', this._accountChanged);
      this._wallet = null;
      this._publicKey = null;
      this.emit('error', new WalletDisconnectedError());
      this.emit('disconnect');
    }
  };

  private _accountChanged = (newPublicKey: unknown) => {
    const currentKey = this._publicKey;
    if (!currentKey) return;
    if (!newPublicKey) {
      this._disconnected();
      return;
    }
    let parsedKey: PublicKey;
    try {
      parsedKey = extractPublicKey(newPublicKey);
    } catch (error: unknown) {
      this.emit('error', new WalletPublicKeyError((error as Error)?.message, error));
      return;
    }
    if (currentKey.equals(parsedKey)) return;
    this._publicKey = parsedKey;
    this.emit('connect', parsedKey);
  };

  async autoConnect(): Promise<void> {
    if (this.readyState === WalletReadyState.Installed) {
      await this.connect();
    }
  }

  async connect(): Promise<void> {
    try {
      if (this.connected || this.connecting) return;

      if (this.readyState === WalletReadyState.Loadable) {
        const url = encodeURIComponent(window.location.href);
        window.location.href = `https://link.trustwallet.com/open_url?coin_id=501&url=${url}`;
        return;
      }

      const wallet = getTrustWalletProvider();
      if (!wallet) {
        throw new WalletNotReadyError();
      }

      if (this._readyState !== WalletReadyState.Installed) {
        this._readyState = WalletReadyState.Installed;
        this.emit('readyStateChange', this._readyState);
      }

      this._connecting = true;

      let connectResult: { publicKey?: { toBytes(): Uint8Array } } | void = undefined;
      if (!wallet.isConnected || !wallet.publicKey) {
        try {
          connectResult = await wallet.connect();
        } catch (error: unknown) {
          throw new WalletConnectionError((error as Error)?.message, error);
        }
      }

      const rawKey = wallet.publicKey ?? (connectResult && 'publicKey' in connectResult ? connectResult.publicKey : null);
      if (!rawKey) {
        throw new WalletAccountError();
      }

      let publicKey: PublicKey;
      try {
        publicKey = extractPublicKey(rawKey);
      } catch (error: unknown) {
        throw new WalletPublicKeyError((error as Error)?.message, error);
      }

      wallet.on?.('disconnect', this._disconnected);
      wallet.on?.('accountChanged', this._accountChanged);

      this._wallet = wallet;
      this._publicKey = publicKey;
      this.emit('connect', publicKey);
    } catch (error: unknown) {
      const walletErr =
        error instanceof WalletError
          ? error
          : new WalletConnectionError((error as Error)?.message, error);
      this.emit('error', walletErr);
      throw walletErr;
    } finally {
      this._connecting = false;
    }
  }

  async disconnect(): Promise<void> {
    const wallet = this._wallet;
    if (wallet) {
      wallet.off?.('disconnect', this._disconnected);
      wallet.removeListener?.('disconnect', this._disconnected);
      wallet.off?.('accountChanged', this._accountChanged);
      wallet.removeListener?.('accountChanged', this._accountChanged);
      this._wallet = null;
      this._publicKey = null;

      try {
        await wallet.disconnect();
      } catch (error: unknown) {
        this.emit('error', new WalletDisconnectionError((error as Error)?.message, error));
      }
    }
    this.emit('disconnect');
  }

  async sendTransaction<T extends Transaction | VersionedTransaction>(
    transaction: T,
    connection: Connection,
    options: SendTransactionOptions = {}
  ): Promise<TransactionSignature> {
    try {
      const wallet = this._wallet;
      if (!wallet) throw new WalletNotConnectedError();

      try {
        const { signers, ...sendOptions } = options;
        if (isVersionedTransaction(transaction)) {
          if (signers?.length) transaction.sign(signers);
        } else {
          transaction = (await this.prepareTransaction(transaction, connection, sendOptions)) as T;
          if (signers?.length) (transaction as Transaction).partialSign(...signers);
        }

        sendOptions.preflightCommitment = sendOptions.preflightCommitment || connection.commitment;

        if (typeof wallet.signAndSendTransaction === 'function') {
          const { signature } = await wallet.signAndSendTransaction(transaction, sendOptions);
          return signature;
        }

        const signed = await wallet.signTransaction(transaction);
        const rawTransaction = signed.serialize();
        return await connection.sendRawTransaction(rawTransaction, sendOptions);
      } catch (error: unknown) {
        if (error instanceof WalletError) throw error;
        throw new WalletSendTransactionError((error as Error)?.message, error);
      }
    } catch (error: unknown) {
      const walletErr =
        error instanceof WalletError
          ? error
          : new WalletSendTransactionError((error as Error)?.message, error);
      this.emit('error', walletErr);
      throw walletErr;
    }
  }

  async signTransaction<T extends Transaction | VersionedTransaction>(transaction: T): Promise<T> {
    try {
      const wallet = this._wallet;
      if (!wallet) throw new WalletNotConnectedError();

      try {
        return (await wallet.signTransaction(transaction)) || transaction;
      } catch (error: unknown) {
        throw new WalletSignTransactionError((error as Error)?.message, error);
      }
    } catch (error: unknown) {
      const walletErr =
        error instanceof WalletError
          ? error
          : new WalletSignTransactionError((error as Error)?.message, error);
      this.emit('error', walletErr);
      throw walletErr;
    }
  }

  async signAllTransactions<T extends Transaction | VersionedTransaction>(transactions: T[]): Promise<T[]> {
    try {
      const wallet = this._wallet;
      if (!wallet) throw new WalletNotConnectedError();

      try {
        return (await wallet.signAllTransactions(transactions)) || transactions;
      } catch (error: unknown) {
        throw new WalletSignTransactionError((error as Error)?.message, error);
      }
    } catch (error: unknown) {
      const walletErr =
        error instanceof WalletError
          ? error
          : new WalletSignTransactionError((error as Error)?.message, error);
      this.emit('error', walletErr);
      throw walletErr;
    }
  }

  async signMessage(message: Uint8Array): Promise<Uint8Array> {
    try {
      const wallet = this._wallet;
      if (!wallet) throw new WalletNotConnectedError();

      try {
        const res = await wallet.signMessage(message);
        if (res instanceof Uint8Array) return res;
        if (res && res.signature instanceof Uint8Array) return res.signature;
        if (res && ArrayBuffer.isView(res.signature)) {
          return new Uint8Array(res.signature.buffer, res.signature.byteOffset, res.signature.byteLength);
        }
        throw new Error('Invalid signature returned from Trust Wallet');
      } catch (error: unknown) {
        throw new WalletSignMessageError((error as Error)?.message, error);
      }
    } catch (error: unknown) {
      const walletErr =
        error instanceof WalletError
          ? error
          : new WalletSignMessageError((error as Error)?.message, error);
      this.emit('error', walletErr);
      throw walletErr;
    }
  }
}
