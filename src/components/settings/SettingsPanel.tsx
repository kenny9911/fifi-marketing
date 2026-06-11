"use client";

import { useEffect, useRef, useState } from "react";
import { api, ApiClientError } from "@/lib/client-api";
import { useSession } from "@/components/hooks/useSession";
import { RecoveryCodeModal } from "@/components/auth/RecoveryCodeModal";
import { Tip } from "@/components/shared/Tip";
import { PLATFORMS } from "@/lib/platforms";
import type { PlatformId } from "@/lib/types";
import type { UserDto, UserSettings } from "@/lib/api-types";

const INPUT_CLS =
  "w-full rounded-[12px] border-[1.5px] border-tan-mid bg-paper px-4 py-2.5 text-[14px] outline-none transition-colors focus:border-ink";

const SAVE_BTN =
  "cursor-pointer rounded-[12px] border-2 border-ink bg-ink px-5 py-2.5 text-[13.5px] font-bold text-paper shadow-[4px_4px_0_#FFC53D] disabled:cursor-not-allowed disabled:opacity-50";

/**
 * Remove CoachMarks first-visit records so the guided hints replay the next
 * time they are enabled. CoachMarks stores dismissal flags in localStorage.
 */
function clearCoachStorage() {
  try {
    const doomed: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (!key) continue;
      if (key.startsWith("fifi-coach") || key.toLowerCase().includes("coachmark")) {
        doomed.push(key);
      }
    }
    doomed.forEach((key) => window.localStorage.removeItem(key));
  } catch {
    // localStorage 不可用时静默跳过
  }
}

function SettingsCard({
  en,
  title,
  children,
}: {
  en: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-[18px] border-2 border-ink bg-paper p-6 shadow-[6px_6px_0_#17130C]">
      <div className="mb-5 flex items-baseline justify-between gap-2">
        <h2 className="font-display text-[24px] font-normal">{title}</h2>
        <span className="font-grotesk text-[11px] font-bold tracking-[2px] text-stone">
          {en}
        </span>
      </div>
      {children}
    </section>
  );
}

/** Account settings panel: profile / preferences / security cards + toast. */
export function SettingsPanel() {
  const { user, loading, refresh } = useSession();

  const [displayName, setDisplayName] = useState("");
  const [settings, setSettings] = useState<UserSettings>({});
  const hydratedFor = useRef<string | null>(null);

  const [nameSaving, setNameSaving] = useState(false);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [prefSaving, setPrefSaving] = useState(false);
  const [passSaving, setPassSaving] = useState(false);

  const [passCurrent, setPassCurrent] = useState("");
  const [passNext, setPassNext] = useState("");
  const [passNext2, setPassNext2] = useState("");
  const [passError, setPassError] = useState<string | null>(null);

  // recovery-code rotation (authenticated, SPEC §6)
  const [rotatePass, setRotatePass] = useState("");
  const [rotating, setRotating] = useState(false);
  const [rotateError, setRotateError] = useState<string | null>(null);
  /** freshly rotated code — shown once in the RecoveryCodeModal */
  const [freshCode, setFreshCode] = useState<string | null>(null);

  const fileRef = useRef<HTMLInputElement | null>(null);

  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    },
    [],
  );

  // 加载到用户后，把资料和偏好灌进本地表单（每个用户只灌一次）
  useEffect(() => {
    if (user && hydratedFor.current !== user.id) {
      hydratedFor.current = user.id;
      setDisplayName(user.displayName);
      setSettings({
        defaultPlatforms: user.settings.defaultPlatforms ?? [],
        hintsEnabled: user.settings.hintsEnabled ?? true,
        locale: user.settings.locale ?? "zh",
      });
    }
  }, [user]);

  // 未登录（或会话过期）→ 回登录页，带上回跳地址
  useEffect(() => {
    if (!loading && !user) {
      window.location.assign("/login?next=%2Fsettings");
    }
  }, [loading, user]);

  function showToast(msg: string) {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2400);
  }

  function fail(err: unknown, fallback: string) {
    if (err instanceof ApiClientError) {
      if (err.status === 401) {
        window.location.assign("/login?next=%2Fsettings");
        return;
      }
      if (err.message) {
        showToast(`✗ ${err.message}`);
        return;
      }
    }
    showToast(`✗ ${fallback}`);
  }

  async function saveDisplayName() {
    const name = displayName.trim();
    if (!name) {
      showToast("✗ 昵称不能为空");
      return;
    }
    setNameSaving(true);
    try {
      await api.put<{ user: UserDto }>("/api/profile", { displayName: name });
      await refresh();
      showToast("昵称已保存 ✓");
    } catch (err) {
      fail(err, "保存失败，请稍后再试");
    } finally {
      setNameSaving(false);
    }
  }

  async function uploadAvatar(file: File) {
    setAvatarBusy(true);
    try {
      const uploaded = await api.upload(file);
      await api.put<{ user: UserDto }>("/api/profile", {
        avatarFileId: uploaded.id,
      });
      await refresh();
      showToast("头像已更新 ✓");
    } catch (err) {
      fail(err, "头像上传失败，请稍后再试");
    } finally {
      setAvatarBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function saveSettings(patch: Partial<UserSettings>, msg: string) {
    const prevSettings = settings;
    const nextSettings = { ...settings, ...patch };
    setSettings(nextSettings);
    setPrefSaving(true);
    try {
      await api.put<{ user: UserDto }>("/api/profile", {
        settings: nextSettings,
      });
      await refresh();
      showToast(msg);
    } catch (err) {
      // 乐观更新回滚：保存失败时表单回到上一份已持久化的偏好
      setSettings(prevSettings);
      fail(err, "偏好保存失败，请稍后再试");
    } finally {
      setPrefSaving(false);
    }
  }

  function togglePlatform(id: PlatformId) {
    const current = settings.defaultPlatforms ?? [];
    const next = current.includes(id)
      ? current.filter((p) => p !== id)
      : [...current, id];
    void saveSettings({ defaultPlatforms: next }, "默认平台已更新 ✓");
  }

  function toggleHints() {
    const next = !(settings.hintsEnabled ?? true);
    // 重新开启时清除「已看过」记录，让新手引导重新播放；
    // 关闭只是隐藏引导，记录保留
    if (next) clearCoachStorage();
    void saveSettings(
      { hintsEnabled: next },
      next ? "提示已开启，新手引导会重新出现 ✓" : "提示已关闭 ✓",
    );
  }

  async function savePassword(e: React.FormEvent) {
    e.preventDefault();
    setPassError(null);
    if (passNext.length < 8) {
      setPassError("新密码至少 8 位");
      return;
    }
    if (passNext !== passNext2) {
      setPassError("两次输入的新密码不一致");
      return;
    }
    setPassSaving(true);
    try {
      await api.put<{ user: UserDto }>("/api/profile", {
        password: { current: passCurrent, next: passNext },
      });
      setPassCurrent("");
      setPassNext("");
      setPassNext2("");
      showToast("密码已更新 ✓");
    } catch (err) {
      if (err instanceof ApiClientError && err.status !== 401 && err.message) {
        setPassError(err.message);
      } else {
        fail(err, "密码修改失败，请稍后再试");
      }
    } finally {
      setPassSaving(false);
    }
  }

  async function rotateRecovery(e: React.FormEvent) {
    e.preventDefault();
    setRotateError(null);
    setRotating(true);
    try {
      const res = await api.put<{ user: UserDto; recoveryCode?: string }>(
        "/api/profile",
        { rotateRecoveryCode: { password: rotatePass } },
      );
      setRotatePass("");
      if (res.recoveryCode) {
        setFreshCode(res.recoveryCode);
      } else {
        showToast("✗ 服务端未返回新恢复码，请稍后再试");
      }
    } catch (err) {
      if (err instanceof ApiClientError && err.status !== 401 && err.message) {
        setRotateError(err.message);
      } else {
        fail(err, "恢复码更换失败，请稍后再试");
      }
    } finally {
      setRotating(false);
    }
  }

  if (loading || !user) {
    return (
      <main className="mx-auto max-w-[920px] px-6 py-24 text-center">
        <div className="inline-block rounded-[18px] border-2 border-ink bg-paper px-8 py-6 shadow-[6px_6px_0_#17130C]">
          <span className="font-display text-[20px]">正在加载你的设置</span>
          <span className="ml-1 animate-blink">…</span>
        </div>
      </main>
    );
  }

  const selectedPlatforms = settings.defaultPlatforms ?? [];
  const hintsOn = settings.hintsEnabled ?? true;

  return (
    <main className="mx-auto max-w-[920px] space-y-7 px-6 py-10">
      {/* ===== 个人资料 ===== */}
      <SettingsCard title="个人资料" en="PROFILE">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-start">
          {/* avatar */}
          <div className="flex shrink-0 flex-col items-center gap-3">
            {user.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- presigned MinIO URL，域名不固定
              <img
                src={user.avatarUrl}
                alt={`${user.displayName} 的头像`}
                className="h-[84px] w-[84px] rounded-full border-2 border-ink bg-sand object-cover"
              />
            ) : (
              <div
                aria-hidden
                className="flex h-[84px] w-[84px] items-center justify-center rounded-full border-2 border-ink bg-klein font-display text-[34px] text-paper"
              >
                {user.displayName.slice(0, 1)}
              </div>
            )}
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              title="选择头像图片"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void uploadAvatar(f);
              }}
            />
            <button
              type="button"
              disabled={avatarBusy}
              onClick={() => fileRef.current?.click()}
              title="上传一张图片作为头像"
              className="cursor-pointer rounded-full border-[1.5px] border-ink bg-paper px-4 py-1.5 text-[12.5px] font-bold disabled:cursor-not-allowed disabled:opacity-50"
            >
              {avatarBusy ? "上传中…" : "上传头像"}
            </button>
            {!user.avatarUrl && (
              <p className="max-w-[120px] text-center text-[11.5px] leading-[1.6] text-stone">
                还没有头像，点「上传头像」选一张图
              </p>
            )}
          </div>

          {/* display name + account info */}
          <div className="min-w-0 flex-1 space-y-4">
            <div>
              <label
                htmlFor="settings-display-name"
                className="mb-1.5 block text-[13px] font-bold text-soot"
              >
                昵称
              </label>
              <div className="flex gap-2.5">
                <input
                  id="settings-display-name"
                  className={INPUT_CLS}
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  maxLength={64}
                  placeholder="想让灰灰怎么称呼你？"
                  title="修改展示昵称"
                />
                <button
                  type="button"
                  onClick={() => void saveDisplayName()}
                  disabled={nameSaving || displayName.trim() === user.displayName}
                  title="保存昵称"
                  className={SAVE_BTN}
                >
                  {nameSaving ? "保存中…" : "保存"}
                </button>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 text-[12.5px]">
              <span
                className="rounded-full border border-tan bg-cream px-3 py-1 text-soot"
                title="登录用户名，注册后不可修改"
              >
                用户名 · {user.username}
              </span>
              <span
                className="rounded-full border border-tan bg-cream px-3 py-1 text-soot"
                title="账号角色"
              >
                {user.role === "admin" ? "管理员" : "创作者"}
              </span>
            </div>
          </div>
        </div>
      </SettingsCard>

      {/* ===== 创作偏好 ===== */}
      <SettingsCard title="创作偏好" en="PREFERENCES">
        <div className="space-y-6">
          {/* default platforms */}
          <div>
            <div className="mb-2 text-[13px] font-bold text-soot">
              默认平台
              <span className="ml-2 font-normal text-stone">
                新建任务时自动勾选这些平台
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              {PLATFORMS.map((p) => {
                const selected = selectedPlatforms.includes(p.id);
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => togglePlatform(p.id)}
                    disabled={prefSaving}
                    title={
                      selected
                        ? `取消默认平台「${p.name}」`
                        : `把「${p.name}」设为默认平台`
                    }
                    className={`cursor-pointer rounded-full border-[1.5px] px-[15px] py-[8px] text-[13.5px] font-medium transition-opacity disabled:cursor-wait ${
                      selected ? "text-white" : "border-tan-mid bg-paper text-ink"
                    }`}
                    style={
                      selected
                        ? { background: p.uiColor, borderColor: p.uiColor }
                        : undefined
                    }
                  >
                    {selected ? "✓ " : ""}
                    {p.name}
                  </button>
                );
              })}
            </div>
            {selectedPlatforms.length === 0 && (
              <p className="mt-2.5 text-[12.5px] text-stone">
                还没选默认平台——点上方任意平台勾选，下次建任务就会自动带上。
              </p>
            )}
          </div>

          {/* hints toggle */}
          <div className="flex items-start justify-between gap-4 border-t-[1.5px] border-dashed border-tan pt-5">
            <div>
              <div className="text-[13px] font-bold text-soot">新手提示</div>
              <p className="mt-1 max-w-[520px] text-[12.5px] leading-[1.7] text-stone">
                控制创作台的新手引导。关闭后引导不再弹出；
                重新开启会清除已看过的记录，引导将重新播放。
              </p>
            </div>
            <Tip tip={hintsOn ? "点击关闭新手提示" : "点击开启新手提示"}>
              <button
                type="button"
                role="switch"
                aria-checked={hintsOn}
                onClick={toggleHints}
                disabled={prefSaving}
                title={hintsOn ? "关闭新手提示" : "开启新手提示"}
                className={`relative h-[28px] w-[52px] shrink-0 cursor-pointer rounded-full border-2 border-ink transition-colors disabled:cursor-wait ${
                  hintsOn ? "bg-jade" : "bg-sand"
                }`}
              >
                <span
                  aria-hidden
                  className={`absolute top-[2px] h-[20px] w-[20px] rounded-full border-2 border-ink bg-paper transition-[left] ${
                    hintsOn ? "left-[26px]" : "left-[2px]"
                  }`}
                />
              </button>
            </Tip>
          </div>

          {/* locale — interface is Chinese-only for now; the switch ships with i18n */}
          <div className="flex items-center justify-between gap-4 border-t-[1.5px] border-dashed border-tan pt-5">
            <div>
              <label
                htmlFor="settings-locale"
                className="text-[13px] font-bold text-soot"
              >
                界面语言
                <span className="ml-2 rounded-full border border-tan-mid bg-cream px-2 py-[2px] font-grotesk text-[10px] font-bold tracking-[1px] text-stone">
                  COMING SOON
                </span>
              </label>
              <p className="mt-1 text-[12.5px] text-stone">
                生成内容始终为中文。英文界面正在开发中，上线后这里即可切换。
              </p>
            </div>
            <Tip tip="界面语言切换即将上线，当前界面仅提供中文">
              <select
                id="settings-locale"
                value={settings.locale ?? "zh"}
                disabled
                title="界面语言切换即将上线，当前界面仅提供中文"
                className="cursor-not-allowed rounded-[10px] border-[1.5px] border-tan-mid bg-cream px-3 py-2 text-[13.5px] text-stone outline-none"
              >
                <option value="zh">中文</option>
                <option value="en">English</option>
              </select>
            </Tip>
          </div>
        </div>
      </SettingsCard>

      {/* ===== 账号安全 ===== */}
      <SettingsCard title="账号安全" en="SECURITY">
        <div className="space-y-6">
          {/* change password */}
          <form onSubmit={savePassword} className="space-y-4">
            <div className="text-[13px] font-bold text-soot">修改密码</div>
            {passError && (
              <div
                role="alert"
                className="rounded-[10px] border-[1.5px] border-poppy bg-[#fff1ee] px-3.5 py-2.5 text-[13px] font-bold text-poppy"
              >
                ✗ {passError}
              </div>
            )}
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <label
                  htmlFor="settings-pass-current"
                  className="mb-1.5 block text-[12.5px] font-bold text-soot"
                >
                  当前密码
                </label>
                <input
                  id="settings-pass-current"
                  type="password"
                  className={INPUT_CLS}
                  value={passCurrent}
                  onChange={(e) => setPassCurrent(e.target.value)}
                  autoComplete="current-password"
                  title="输入当前使用的密码"
                  required
                />
              </div>
              <div>
                <label
                  htmlFor="settings-pass-next"
                  className="mb-1.5 block text-[12.5px] font-bold text-soot"
                >
                  新密码
                </label>
                <input
                  id="settings-pass-next"
                  type="password"
                  className={INPUT_CLS}
                  value={passNext}
                  onChange={(e) => setPassNext(e.target.value)}
                  autoComplete="new-password"
                  placeholder="至少 8 位"
                  title="设置新密码（至少 8 位）"
                  required
                />
              </div>
              <div>
                <label
                  htmlFor="settings-pass-next2"
                  className="mb-1.5 block text-[12.5px] font-bold text-soot"
                >
                  确认新密码
                </label>
                <input
                  id="settings-pass-next2"
                  type="password"
                  className={INPUT_CLS}
                  value={passNext2}
                  onChange={(e) => setPassNext2(e.target.value)}
                  autoComplete="new-password"
                  placeholder="再输入一次"
                  title="再次输入新密码以确认"
                  required
                />
              </div>
            </div>
            <button
              type="submit"
              disabled={passSaving}
              title="保存新密码"
              className={SAVE_BTN}
            >
              {passSaving ? "更新中…" : "更新密码"}
            </button>
          </form>

          {/* recovery code — authenticated rotate, new code shown once */}
          <form
            onSubmit={(e) => void rotateRecovery(e)}
            className="rounded-[14px] border-[1.5px] border-tan bg-cream p-5"
          >
            <div className="mb-1.5 flex items-center gap-2 text-[13px] font-bold text-soot">
              更换恢复码
              <span className="font-grotesk text-[10px] font-bold tracking-[1.5px] text-stone">
                RECOVERY CODE
              </span>
            </div>
            <p className="mb-4 max-w-[600px] text-[12.5px] leading-[1.8] text-soot">
              恢复码是找回密码的唯一凭证。如果恢复码遗失或想主动更换，
              在下方输入当前密码即可立刻生成一个全新的恢复码（仅显示一次），
              旧码同时作废。
            </p>
            {rotateError && (
              <div
                role="alert"
                className="mb-3 rounded-[10px] border-[1.5px] border-poppy bg-[#fff1ee] px-3.5 py-2.5 text-[13px] font-bold text-poppy"
              >
                ✗ {rotateError}
              </div>
            )}
            <div className="flex max-w-[440px] flex-col gap-2.5 sm:flex-row">
              <input
                id="settings-rotate-pass"
                type="password"
                className={INPUT_CLS}
                value={rotatePass}
                onChange={(e) => setRotatePass(e.target.value)}
                autoComplete="current-password"
                placeholder="当前密码"
                title="输入当前密码以验证身份"
                required
              />
              <button
                type="submit"
                disabled={rotating}
                title="验证密码后立刻生成新恢复码，旧码作废"
                className="shrink-0 cursor-pointer rounded-[12px] border-2 border-ink bg-paper px-5 py-2.5 text-[13.5px] font-bold shadow-[4px_4px_0_#FF4B2E] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {rotating ? "生成中…" : "生成新恢复码 →"}
              </button>
            </div>
          </form>
        </div>
      </SettingsCard>

      {/* one-time reveal of the rotated recovery code */}
      {freshCode && (
        <RecoveryCodeModal
          code={freshCode}
          title="新恢复码已生效"
          message="旧恢复码已作废。这串新恢复码只显示这一次，请立即抄写或复制保存。"
          confirmLabel="我已保存好"
          onConfirm={() => {
            setFreshCode(null);
            showToast("恢复码已更换 ✓");
          }}
        />
      )}

      {/* toast */}
      {toast && (
        <div
          role="status"
          className="fixed bottom-6 left-1/2 z-[90] -translate-x-1/2 rounded-full border-2 border-ink bg-ink px-5 py-2.5 text-[13.5px] font-bold text-paper shadow-[4px_4px_0_#FFC53D]"
        >
          {toast}
        </div>
      )}
    </main>
  );
}
