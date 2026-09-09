import hmac
import logging

from fastapi import Header, HTTPException

from . import config

logger = logging.getLogger("api.auth")


class Caller:
    __slots__ = ("key_id", "tier", "max_rows", "timeout")

    def __init__(self, key_id: str, tier: str):
        self.key_id = key_id
        self.tier = tier if tier in config.TIERS else config.DEFAULT_TIER
        self.max_rows: int | None = config.TIERS[self.tier]["max_rows"]  # None = unlimited
        self.timeout: float = config.TIERS[self.tier]["timeout"]


def gateway(
    x_gateway_secret: str = Header(default=""),
    x_key_id: str = Header(default="anonymous"),
    x_tier: str = Header(default=config.DEFAULT_TIER),
) -> Caller:
    """Only the Cloudflare Worker knows the gateway secret, so only it can reach the data routes."""
    if config.DEV_MODE:
        return Caller(x_key_id, x_tier)
    if not config.GATEWAY_SECRET or not hmac.compare_digest(x_gateway_secret, config.GATEWAY_SECRET):
        raise HTTPException(status_code=403, detail="Direct access is not allowed; use the public API endpoint.")
    return Caller(x_key_id, x_tier)
