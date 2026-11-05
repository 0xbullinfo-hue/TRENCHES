from __future__ import annotations

import base64
import binascii

import base58
from nacl.exceptions import BadSignatureError, CryptoError
from nacl.signing import VerifyKey

SIG_MESSAGE_PREFIX = "TrenchLabsHQ-verify:"
NONCE_TTL_SECONDS = 300
SIG_ALGORITHM = "ed25519"


class SignatureFormatError(ValueError):
    """Signature or wallet input cannot be decoded to the required wire format."""


def _decode_wallet(wallet_address: str) -> bytes:
    try:
        wallet_bytes = base58.b58decode(wallet_address)
    except (ValueError, TypeError) as exc:
        raise SignatureFormatError("wallet address is not valid base58") from exc
    if len(wallet_bytes) != 32:
        raise SignatureFormatError("wallet address must decode to exactly 32 bytes")
    return wallet_bytes


def _decode_signature(signature_b64: str) -> bytes:
    try:
        signature_bytes = base64.b64decode(signature_b64, validate=True)
    except (binascii.Error, ValueError, TypeError) as exc:
        raise SignatureFormatError("signature must be valid base64") from exc
    if len(signature_bytes) != 64:
        raise SignatureFormatError("signature must decode to exactly 64 bytes")
    return signature_bytes


async def verify_signature(
    wallet_address: str,
    message: str,
    signature_b64: str,
) -> bool:
    """Verify an Ed25519 signature against the public key encoded by the wallet address.

    The message is signed as exact UTF-8 bytes; it is never hashed or normalized here.
    Structurally malformed wallet/signature encodings raise SignatureFormatError.
    A validly encoded but incorrect signature returns False.
    """
    wallet_bytes = _decode_wallet(wallet_address)
    signature_bytes = _decode_signature(signature_b64)
    try:
        VerifyKey(wallet_bytes).verify(message.encode("utf-8"), signature_bytes)
        return True
    except (BadSignatureError, CryptoError, ValueError):
        return False
