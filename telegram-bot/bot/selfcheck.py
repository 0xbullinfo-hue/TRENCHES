from __future__ import annotations

from dataclasses import dataclass

from telegram import Bot

from lib.config import Settings


@dataclass(frozen=True)
class CheckResult:
    ok: bool
    lines: tuple[str, ...]


async def check_telegram_permissions(bot: Bot, settings: Settings) -> CheckResult:
    me = await bot.get_me()
    lines = [f"Bot @{me.username or me.id} token valid"]
    failures: list[str] = []
    entities = [
        ("Pro group", settings.pro_group_id, ("can_invite_users", "can_restrict_members")),
        ("Member group", settings.member_group_id, ("can_invite_users", "can_restrict_members")),
        ("Results channel", settings.public_channel_id, ("can_post_messages",)),
        ("Public community", settings.public_community_group_id,
         ("can_delete_messages", "can_restrict_members")),
    ]
    ui_steps = {
        "can_invite_users": "Group Info → Manage Group → Administrators → bot → Invite Users",
        "can_restrict_members": "Group Info → Manage Group → Administrators → bot → Ban Users",
        "can_delete_messages": "Group Info → Manage Group → Administrators → bot → Delete Messages",
        "can_post_messages": "Channel Info → Manage Channel → Administrators → bot → Post Messages",
    }
    for label, chat_id, required in entities:
        try:
            chat = await bot.get_chat(chat_id)
            member = await bot.get_chat_member(chat_id, me.id)
            status = getattr(member.status, "value", member.status)
            missing = []
            if status != "administrator":
                missing.append("administrator status")
            for permission in required:
                if getattr(member, permission, False) is not True:
                    missing.append(permission)
            if missing:
                fixes = "; ".join(ui_steps[item] for item in missing if item in ui_steps)
                lines.append(f"FAIL {label} ({chat_id}): missing {', '.join(missing)}. Fix: {fixes}")
                failures.append(label)
            else:
                lines.append(f"OK {label}: {chat.title} ({chat_id})")
        except Exception as exc:
            required_text = ", ".join(required)
            fix_text = "; ".join(ui_steps[item] for item in required)
            lines.append(
                f"FAIL {label} ({chat_id}): could not confirm bot membership "
                f"({type(exc).__name__}). Add the bot to the chat as an administrator "
                f"with {required_text}; UI: {fix_text}"
            )
            failures.append(label)
    return CheckResult(not failures, tuple(lines))


async def startup_self_check(bot: Bot, settings: Settings) -> CheckResult:
    result = await check_telegram_permissions(bot, settings)
    if result.ok:
        await bot.send_message(
            chat_id=settings.bootstrap_owner_id,
            text="TrenchLabsHQ bot online. Self-check passed.\n" + "\n".join(result.lines[1:]),
        )
    return result
