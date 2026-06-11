"use client";

import { useState } from "react";
import Link from "next/link";
import { api, ApiClientError } from "@/lib/client-api";
import { LogoMark } from "@/components/shared/LogoMark";
import { RecoveryCodeModal } from "@/components/auth/RecoveryCodeModal";
import type { RegisterResponse, UserDto } from "@/lib/api-types";

export type AuthTab = "login" | "register" | "forgot";

const TABS: { id: AuthTab; label: string }[] = [
  { id: "login", label: "登录" },
  { id: "register", label: "注册" },
  { id: "forgot", label: "忘记密码" },
];

const INPUT_CLS =
  "w-full rounded-[12px] border-[1.5px] border-tan-mid bg-paper px-4 py-3 text-[14.5px] outline-none transition-colors focus:border-ink";

const PRIMARY_BTN =
  "w-full cursor-pointer rounded-[14px] border-2 border-ink bg-poppy px-6 py-3.5 text-[16px] font-bold text-paper shadow-[5px_5px_0_#17130C] transition-[transform,box-shadow] active:translate-x-[2px] active:translate-y-[2px] active:shadow-[3px_3px_0_#17130C] disabled:cursor-not-allowed disabled:opacity-60";

/** Map API failures to friendly, action-oriented Chinese copy. */
function friendlyError(err: unknown, tab: AuthTab): string {
  if (err instanceof ApiClientError) {
    if (err.status === 401)
      return tab === "forgot"
        ? "用户名或恢复码不对，再核对一下"
        : "用户名或密码不对，再试一次";
    if (err.status === 409) return "这个用户名已被注册，换一个试试";
    if (err.status === 429) return "尝试次数太多，请 15 分钟后再来";
    if (err.message) return err.message;
  }
  return "网络开小差了，请稍后再试";
}

function Field({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label
        htmlFor={id}
        className="mb-1.5 flex items-baseline justify-between text-[13px] font-bold text-soot"
      >
        <span>{label}</span>
        {hint && (
          <span className="text-[11.5px] font-normal text-stone">{hint}</span>
        )}
      </label>
      {children}
    </div>
  );
}

/**
 * Centered auth card with three tabs: 登录 / 注册 / 忘记密码.
 * `next` is the already-validated same-site path to land on after auth.
 */
export function LoginCard({
  next,
  initialTab = "login",
}: {
  next?: string;
  initialTab?: AuthTab;
}) {
  // Defense in depth: re-validate even though the page already did.
  const dest =
    next && next.startsWith("/") && !next.startsWith("//") ? next : "/studio";

  const [tab, setTab] = useState<AuthTab>(initialTab);
  const [pending, setPending] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [loginUser, setLoginUser] = useState("");
  const [loginPass, setLoginPass] = useState("");

  const [regUser, setRegUser] = useState("");
  const [regName, setRegName] = useState("");
  const [regPass, setRegPass] = useState("");
  const [regPass2, setRegPass2] = useState("");

  const [fUser, setFUser] = useState("");
  const [fCode, setFCode] = useState("");
  const [fPass, setFPass] = useState("");

  const [modal, setModal] = useState<{
    code: string;
    mode: "register" | "reset";
  } | null>(null);

  function switchTab(t: AuthTab) {
    setTab(t);
    setError(null);
    setNotice(null);
  }

  async function submitLogin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      await api.post<{ user: UserDto }>("/api/auth/login", {
        username: loginUser.trim(),
        password: loginPass,
      });
      // Full navigation so server components pick up the fresh cookie.
      window.location.assign(dest);
    } catch (err) {
      setError(friendlyError(err, "login"));
      setPending(false);
    }
  }

  async function submitRegister(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (regPass.length < 8) {
      setError("密码至少 8 位");
      return;
    }
    if (regPass !== regPass2) {
      setError("两次输入的密码不一致");
      return;
    }
    setPending(true);
    try {
      const res = await api.post<RegisterResponse>("/api/auth/register", {
        username: regUser.trim(),
        password: regPass,
        ...(regName.trim() ? { displayName: regName.trim() } : {}),
      });
      setModal({ code: res.recoveryCode, mode: "register" });
    } catch (err) {
      setError(friendlyError(err, "register"));
    } finally {
      setPending(false);
    }
  }

  async function submitForgot(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (fPass.length < 8) {
      setError("新密码至少 8 位");
      return;
    }
    setPending(true);
    try {
      const res = await api.post<{ ok: boolean; recoveryCode: string }>(
        "/api/auth/reset",
        {
          username: fUser.trim(),
          recoveryCode: fCode.trim(),
          newPassword: fPass,
        },
      );
      setModal({ code: res.recoveryCode, mode: "reset" });
    } catch (err) {
      setError(friendlyError(err, "forgot"));
    } finally {
      setPending(false);
    }
  }

  function confirmModal() {
    if (!modal) return;
    if (modal.mode === "register") {
      setLeaving(true);
      window.location.assign(dest);
      return;
    }
    // 重置成功 → 回到登录页签，预填用户名
    setLoginUser(fUser.trim());
    setLoginPass("");
    setFUser("");
    setFCode("");
    setFPass("");
    setModal(null);
    switchTab("login");
    setNotice("密码已重置，新恢复码已生效——用新密码登录吧");
  }

  return (
    <div className="relative z-10 w-full max-w-[440px]">
      <div className="rounded-[20px] border-2 border-ink bg-paper p-7 shadow-[10px_10px_0_#17130C] sm:p-8">
        {/* card header */}
        <div className="mb-6 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5" title="回到首页">
            <LogoMark size={24} />
            <span className="font-display text-[22px] font-normal leading-none">
              灰灰营销
            </span>
            <span className="font-grotesk text-[11px] font-bold tracking-[1.5px] text-poppy">
              FiFi*
            </span>
          </Link>
          <span className="font-grotesk text-[11px] font-bold tracking-[2px] text-stone">
            MEMBERS
          </span>
        </div>

        {/* tabs */}
        <div
          role="tablist"
          aria-label="登录方式"
          className="mb-6 grid grid-cols-3 gap-1.5 rounded-[14px] border-[1.5px] border-tan bg-cream p-1.5"
        >
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => switchTab(t.id)}
              title={`切换到「${t.label}」`}
              className={`cursor-pointer rounded-[10px] px-2 py-2 text-[14px] font-bold transition-colors ${
                tab === t.id ? "bg-ink text-paper" : "text-soot hover:text-ink"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {notice && (
          <div className="mb-4 rounded-[10px] border-[1.5px] border-jade bg-[#eefaf4] px-3.5 py-2.5 text-[13px] font-bold leading-[1.7] text-jade">
            ✓ {notice}
          </div>
        )}
        {error && (
          <div
            role="alert"
            className="mb-4 rounded-[10px] border-[1.5px] border-poppy bg-[#fff1ee] px-3.5 py-2.5 text-[13px] font-bold leading-[1.7] text-poppy"
          >
            ✗ {error}
          </div>
        )}

        {tab === "login" && (
          <form onSubmit={submitLogin} className="space-y-4">
            <Field id="login-username" label="用户名">
              <input
                id="login-username"
                className={INPUT_CLS}
                value={loginUser}
                onChange={(e) => setLoginUser(e.target.value)}
                autoComplete="username"
                placeholder="你的用户名"
                title="输入注册时的用户名"
                required
              />
            </Field>
            <Field id="login-password" label="密码">
              <input
                id="login-password"
                type="password"
                className={INPUT_CLS}
                value={loginPass}
                onChange={(e) => setLoginPass(e.target.value)}
                autoComplete="current-password"
                placeholder="••••••••"
                title="输入密码"
                required
              />
            </Field>
            <button
              type="submit"
              disabled={pending}
              title="登录灰灰营销"
              className={PRIMARY_BTN}
            >
              {pending ? "登录中…" : "登录 →"}
            </button>
            <div className="flex justify-between text-[12.5px] text-stone">
              <button
                type="button"
                onClick={() => switchTab("forgot")}
                title="用恢复码找回密码"
                className="cursor-pointer underline underline-offset-2 hover:text-ink"
              >
                忘了密码？
              </button>
              <button
                type="button"
                onClick={() => switchTab("register")}
                title="注册新账号"
                className="cursor-pointer underline underline-offset-2 hover:text-ink"
              >
                没有账号，去注册
              </button>
            </div>
          </form>
        )}

        {tab === "register" && (
          <form onSubmit={submitRegister} className="space-y-4">
            <Field
              id="reg-username"
              label="用户名"
              hint="3–32 位字母 / 数字 / _ / -"
            >
              <input
                id="reg-username"
                className={INPUT_CLS}
                value={regUser}
                onChange={(e) => setRegUser(e.target.value)}
                autoComplete="username"
                placeholder="例如 fifi_fan"
                title="设置登录用户名"
                required
              />
            </Field>
            <Field id="reg-name" label="昵称" hint="选填，不填则用用户名">
              <input
                id="reg-name"
                className={INPUT_CLS}
                value={regName}
                onChange={(e) => setRegName(e.target.value)}
                autoComplete="nickname"
                placeholder="想让灰灰怎么称呼你？"
                title="设置展示昵称"
              />
            </Field>
            <Field id="reg-password" label="密码" hint="至少 8 位">
              <input
                id="reg-password"
                type="password"
                className={INPUT_CLS}
                value={regPass}
                onChange={(e) => setRegPass(e.target.value)}
                autoComplete="new-password"
                placeholder="••••••••"
                title="设置登录密码（至少 8 位）"
                required
              />
            </Field>
            <Field id="reg-password2" label="确认密码">
              <input
                id="reg-password2"
                type="password"
                className={INPUT_CLS}
                value={regPass2}
                onChange={(e) => setRegPass2(e.target.value)}
                autoComplete="new-password"
                placeholder="再输入一次"
                title="再次输入密码以确认"
                required
              />
            </Field>
            <button
              type="submit"
              disabled={pending}
              title="创建账号并领取一次性恢复码"
              className={PRIMARY_BTN}
            >
              {pending ? "注册中…" : "注册并领取恢复码 →"}
            </button>
            <p className="text-center text-[12px] leading-[1.7] text-stone">
              注册成功后会发放一次性恢复码（找回密码用），只显示一次，请务必保存。
            </p>
          </form>
        )}

        {tab === "forgot" && (
          <form onSubmit={submitForgot} className="space-y-4">
            <Field id="forgot-username" label="用户名">
              <input
                id="forgot-username"
                className={INPUT_CLS}
                value={fUser}
                onChange={(e) => setFUser(e.target.value)}
                autoComplete="username"
                placeholder="你的用户名"
                title="输入要找回密码的用户名"
                required
              />
            </Field>
            <Field
              id="forgot-code"
              label="恢复码"
              hint="注册或上次重置时发放"
            >
              <input
                id="forgot-code"
                className={`${INPUT_CLS} font-mono uppercase tracking-[2px]`}
                value={fCode}
                onChange={(e) => setFCode(e.target.value)}
                autoComplete="one-time-code"
                placeholder="XXXX-XXXX-XXXX"
                title="输入你保存的恢复码"
                required
              />
            </Field>
            <Field id="forgot-password" label="新密码" hint="至少 8 位">
              <input
                id="forgot-password"
                type="password"
                className={INPUT_CLS}
                value={fPass}
                onChange={(e) => setFPass(e.target.value)}
                autoComplete="new-password"
                placeholder="设置一个新密码"
                title="设置新密码（至少 8 位）"
                required
              />
            </Field>
            <button
              type="submit"
              disabled={pending}
              title="验证恢复码并重置密码"
              className={PRIMARY_BTN}
            >
              {pending ? "重置中…" : "重置密码 →"}
            </button>
            <p className="text-center text-[12px] leading-[1.7] text-stone">
              重置成功后会发放新的恢复码，旧恢复码立即作废。
            </p>
          </form>
        )}
      </div>

      <p className="mt-5 text-center text-[12.5px] text-stone">
        先逛逛？
        <Link
          href="/"
          title="回到首页"
          className="underline underline-offset-2 hover:text-ink"
        >
          回首页
        </Link>
        {" · "}
        <Link
          href="/guide"
          title="查看各平台爆款方法论"
          className="underline underline-offset-2 hover:text-ink"
        >
          看创作指南
        </Link>
      </p>

      {modal && (
        <RecoveryCodeModal
          code={modal.code}
          title={
            modal.mode === "register"
              ? "欢迎加入！这是你的恢复码"
              : "密码已重置，这是新的恢复码"
          }
          message={
            modal.mode === "register"
              ? "注册成功。忘记密码时，凭它就能在登录页自助重置，无需邮箱或手机号。"
              : "旧恢复码已作废。下次找回密码请使用这个新码。"
          }
          confirmLabel={
            modal.mode === "register" ? "我已抄下，开始创作 →" : "我已抄下，去登录 →"
          }
          confirmPending={leaving}
          onConfirm={confirmModal}
        />
      )}
    </div>
  );
}
