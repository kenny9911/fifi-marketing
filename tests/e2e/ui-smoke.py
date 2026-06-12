#!/usr/bin/env python3
"""FiFi 灰灰营销 — UI smoke journey (Playwright, headless Chromium).

Covers the full browser journey: register → recovery-code modal → brief chips
→ launch → live thinking timeline → results card → copy → image generation
→ revision (回炉) → session restore → usage → settings → logout → password
reset via recovery code → admin 403 for non-admins.

Run from the repo root with the server in mock mode:

  python3 /Users/kenny/.claude/skills/webapp-testing/scripts/with_server.py \
    --server "env FIFI_DB_PATH=data/fifi-e2e.db TEST_MODE=mock PORT=3221 NEXT_DIST_DIR=.next-e2e npm run dev" \
    --port 3221 -- python3 tests/e2e/ui-smoke.py

BASE_URL (default http://localhost:3221) points the journey at the server.
Exits non-zero on the first failed step; a failure screenshot lands in
data/ui-smoke-failure.png.
"""

import os
import re
import sys
import uuid

from playwright.sync_api import expect, sync_playwright

BASE = os.environ.get("BASE_URL", "http://localhost:3221")
USERNAME = f"smoke_{uuid.uuid4().hex[:8]}"
NICKNAME = "冒烟测试员"
PASSWORD_1 = "Sm0ke-Pass-1!"
PASSWORD_2 = "Sm0ke-Pass-2!"

# Deliberately NOT one of the SAMPLE_GOALS so the sidebar title stays unique.
GOAL = "新品冻干速溶咖啡尝鲜装上市，想种草都市年轻白领"

PIPELINE_TIMEOUT = 90_000  # mock pipeline is fast; headroom for dev-server compiles
RECOVERY_RE = re.compile(r"FIFI(-[A-Z0-9]{4}){3}")

_step = 0


def step(name: str) -> None:
    global _step
    _step += 1
    print(f"[{_step:02d}] {name}", flush=True)


def read_recovery_code(dialog) -> str:
    code = dialog.locator("div[class*='font-mono']").first.inner_text().strip()
    assert RECOVERY_RE.fullmatch(code), f"unexpected recovery code: {code!r}"
    return code


def dismiss_coach_marks(page) -> None:
    """First studio visit pops the guided hints overlay — skip it if present."""
    skip = page.get_by_role("button", name="跳过引导")
    try:
        skip.wait_for(state="visible", timeout=5_000)
        skip.click()
    except Exception:
        pass  # already dismissed / not shown


def run(page) -> str:
    # ---- register → recovery modal ----
    step("register a fresh account")
    page.goto(f"{BASE}/login")
    page.get_by_role("tab", name="注册").click()
    page.fill("#reg-username", USERNAME)
    page.fill("#reg-name", NICKNAME)
    page.fill("#reg-password", PASSWORD_1)
    page.fill("#reg-password2", PASSWORD_1)
    page.get_by_role("button", name=re.compile("注册并领取恢复码")).click()

    step("recovery-code modal: read code, copy, confirm")
    dialog = page.get_by_role("dialog")
    expect(dialog).to_be_visible()
    recovery_code = read_recovery_code(dialog)
    dialog.get_by_role("button", name="复制恢复码").click()
    expect(dialog.get_by_role("button", name=re.compile("已复制"))).to_be_visible()
    dialog.get_by_role("button", name=re.compile("我已抄下，开始创作")).click()
    page.wait_for_url(re.compile(r"/studio"))
    dismiss_coach_marks(page)

    # ---- brief intake via chips ----
    step("brief 1/5: goal")
    goal_input = page.get_by_placeholder(re.compile("告诉灰灰你的目标"))
    goal_input.fill(GOAL)
    goal_input.press("Enter")

    step("brief 2/5: audience chip")
    page.get_by_role("button", name="25–35 岁都市白领").click()

    step("brief 3/5: platform chips + confirm")
    page.get_by_role("button", name="小红书", exact=True).click()
    page.get_by_role("button", name=re.compile("就这些，继续")).click()

    step("brief 4/5: style chip")
    page.get_by_role("button", name="真实种草 · 口碑安利").click()

    step("brief 5/5: materials chip")
    page.get_by_role("button", name="只有文字介绍，帮我补全").click()

    # ---- launch → timeline → done ----
    step("launch: 派单给专家团")
    launch = page.get_by_role("button", name=re.compile("派单给专家团"))
    expect(launch).to_be_enabled()
    launch.click()

    step("flight deck: live thinking timeline")
    expect(page.get_by_text("THINKING STREAM")).to_be_visible(timeout=PIPELINE_TIMEOUT)

    step("pipeline reaches 已定稿 (done)")
    expect(page.get_by_text("已定稿 · 想微调")).to_be_visible(timeout=PIPELINE_TIMEOUT)

    # ---- results: card content + copy + prompt packs ----
    step("results deck shows the xhs final card")
    expect(page.get_by_text("成果交付")).to_be_visible()
    expect(page.get_by_text("亲测安利").first).to_be_visible()  # mock crafter title
    expect(page.get_by_text("PROMPT PACKS")).to_be_visible()  # section label (timeline events also say 提示词包)

    step("copy the final (复制全文 → 已复制)")
    page.get_by_role("button", name="复制全文").click()
    expect(page.get_by_role("button", name=re.compile("已复制"))).to_be_visible()

    # ---- image generation (mock 1x1 PNG via in-memory MinIO) ----
    step("generate an image (生成配图)")
    page.get_by_role("button", name=re.compile("生成配图")).click()
    image = page.locator("figure img").first
    expect(image).to_be_visible(timeout=30_000)
    src = image.get_attribute("src") or ""
    assert src.startswith("data:image/"), f"expected mock data-URL image, got {src[:60]!r}"

    # ---- revision: chat message → targeted reedit ----
    step("send a revision directive in chat")
    chat_input = page.get_by_placeholder(re.compile("告诉灰灰要怎么改"))
    chat_input.fill("标题更口语化一点，再加一个互动提问")
    chat_input.press("Enter")
    # "↺ 已回炉重写" is the badge itself (its hover tooltip repeats the phrase)
    expect(page.get_by_text("↺ 已回炉重写")).to_be_visible(timeout=PIPELINE_TIMEOUT)
    expect(page.get_by_text("已定稿 · 想微调")).to_be_visible(timeout=PIPELINE_TIMEOUT)

    # ---- session restore: reload + reopen from the sidebar ----
    step("session restore after reload")
    page.reload()
    dismiss_coach_marks(page)
    page.locator("[role='button'][title*='打开任务']").first.click()
    expect(page.get_by_text("成果交付")).to_be_visible(timeout=30_000)
    expect(page.get_by_text("亲测安利").first).to_be_visible()
    expect(page.get_by_text("THINKING STREAM")).to_be_visible()

    # ---- usage dashboard ----
    step("usage dashboard shows logged calls")
    page.goto(f"{BASE}/usage")
    expect(page.get_by_text("LLM CALLS")).to_be_visible()  # stat card (调用次数 also appears in intro copy)
    report = page.request.get(f"{BASE}/api/usage?scope=daily&days=1").json()
    assert report["totals"]["calls"] > 0, f"expected usage calls > 0, got {report['totals']}"

    # ---- settings ----
    step("settings shows the profile")
    page.goto(f"{BASE}/settings")
    expect(page.get_by_text("个人资料")).to_be_visible()
    expect(page.locator("input[title='修改展示昵称']")).to_have_value(NICKNAME)
    expect(page.get_by_text("账号安全")).to_be_visible()

    # ---- logout ----
    step("logout from the user menu")
    page.goto(f"{BASE}/studio")
    dismiss_coach_marks(page)
    # by nickname — the Next dev-tools button is also aria-haspopup="menu"
    page.get_by_role("button", name=re.compile(NICKNAME)).click()
    page.get_by_role("menuitem", name="退出登录").click()
    page.wait_for_url(re.compile(r"/login"))

    # ---- password reset with the recovery code ----
    step("reset password via recovery code")
    page.get_by_role("tab", name="忘记密码").click()
    page.fill("#forgot-username", USERNAME)
    page.fill("#forgot-code", recovery_code)
    page.fill("#forgot-password", PASSWORD_2)
    page.get_by_role("button", name=re.compile("重置密码")).click()
    dialog = page.get_by_role("dialog")
    expect(dialog).to_be_visible()
    new_code = read_recovery_code(dialog)
    assert new_code != recovery_code, "recovery code was not rotated on reset"
    dialog.get_by_role("button", name=re.compile("我已抄下，去登录")).click()
    expect(page.get_by_text("密码已重置")).to_be_visible()

    step("login with the new password")
    page.fill("#login-username", USERNAME)
    page.fill("#login-password", PASSWORD_2)
    page.get_by_role("button", name=re.compile("^登录")).click()
    page.wait_for_url(re.compile(r"/studio"))

    # ---- admin is for admins only ----
    step("non-admin gets a friendly 403 on /admin")
    page.goto(f"{BASE}/admin")
    expect(page.get_by_text("403 · ADMIN ONLY")).to_be_visible()
    expect(page.get_by_text("仅限管理员进入")).to_be_visible()

    return USERNAME


def main() -> None:
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        context = browser.new_context(
            viewport={"width": 1440, "height": 900},
            permissions=["clipboard-read", "clipboard-write"],
        )
        context.set_default_timeout(30_000)
        page = context.new_page()
        try:
            run(page)
        except Exception as err:  # noqa: BLE001 — any failure fails the smoke
            print(f"\nFAILED at step {_step}: {err}", file=sys.stderr)
            try:
                page.screenshot(path="data/ui-smoke-failure.png", full_page=True)
                print("screenshot: data/ui-smoke-failure.png", file=sys.stderr)
            except Exception:
                pass
            browser.close()
            sys.exit(1)
        browser.close()
        print(f"\nUI-SMOKE PASSED ({_step} steps, user {USERNAME})")


if __name__ == "__main__":
    main()
