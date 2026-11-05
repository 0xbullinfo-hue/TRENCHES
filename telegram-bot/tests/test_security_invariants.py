import ast
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_no_direct_pro_group_send_message_bypasses_protection_wrapper() -> None:
    violations: list[str] = []
    for path in [*ROOT.joinpath("bot").rglob("*.py"), *ROOT.joinpath("api").rglob("*.py")]:
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call):
                continue
            function = node.func
            if isinstance(function, ast.Attribute) and function.attr == "send_message":
                target = ast.unparse(function.value)
                if target == "bot" and "PRO_GROUP_ID" in path.read_text(encoding="utf-8"):
                    violations.append(f"{path.relative_to(ROOT)}:{node.lineno}")
    assert not violations, "Direct Telegram bot sends may bypass Senders.send_pro: " + ", ".join(violations)


def test_pro_sender_always_protects_content() -> None:
    source = ROOT.joinpath("bot", "senders.py").read_text(encoding="utf-8")
    tree = ast.parse(source)
    for node in ast.walk(tree):
        if isinstance(node, ast.FunctionDef) and node.name == "send_pro":
            calls = [n for n in ast.walk(node) if isinstance(n, ast.Call)
                     and isinstance(n.func, ast.Attribute) and n.func.attr == "send_message"]
            assert len(calls) == 1
            assert any(k.arg == "protect_content" and isinstance(k.value, ast.Constant)
                       and k.value.value is True for k in calls[0].keywords)
