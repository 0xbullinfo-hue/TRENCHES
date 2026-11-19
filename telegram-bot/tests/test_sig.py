import base64

import base58
import pytest
from nacl.signing import SigningKey

from lib.sig import SignatureFormatError, verify_signature

MESSAGE = "TrenchLabsHQ-verify:a7f3c9e1b2d40001:1730918400"


def encoded_wallet(key: SigningKey) -> str:
    return base58.b58encode(bytes(key.verify_key)).decode("ascii")


@pytest.mark.asyncio
async def test_known_good_signature_verifies() -> None:
    key = SigningKey(bytes(range(32)))
    signature = base64.b64encode(key.sign(MESSAGE.encode()).signature).decode("ascii")
    assert await verify_signature(encoded_wallet(key), MESSAGE, signature) is True


@pytest.mark.asyncio
async def test_signature_from_different_key_does_not_verify() -> None:
    signer = SigningKey(bytes(range(32)))
    claimed = SigningKey(bytes(reversed(range(32))))
    signature = base64.b64encode(signer.sign(MESSAGE.encode()).signature).decode("ascii")
    assert await verify_signature(encoded_wallet(claimed), MESSAGE, signature) is False


@pytest.mark.asyncio
async def test_tampered_message_does_not_verify() -> None:
    key = SigningKey(bytes(range(32)))
    signature = base64.b64encode(key.sign(MESSAGE.encode()).signature).decode("ascii")
    assert await verify_signature(encoded_wallet(key), MESSAGE + "x", signature) is False


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("wallet", "signature"),
    [
        ("not-base58!", "A" * 88),
        (base58.b58encode(b"short").decode(), "A" * 88),
        (base58.b58encode(bytes(32)).decode(), "not-base64!"),
        (base58.b58encode(bytes(32)).decode(), base64.b64encode(bytes(63)).decode()),
    ],
)
async def test_malformed_wallet_or_signature_raises_format_error(wallet: str, signature: str) -> None:
    with pytest.raises(SignatureFormatError):
        await verify_signature(wallet, MESSAGE, signature)
