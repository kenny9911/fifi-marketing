export type PlatformId = "xhs" | "dy" | "mp" | "wb" | "zh" | "bjh" | "csdn";

export interface Expert {
  /** Chinese persona name, e.g. 桃桃 */
  name: string;
  /** Latin display name, e.g. TAOTAO */
  en: string;
  /** two-letter avatar monogram, e.g. TT */
  mono: string;
  /** role title, e.g. 种草主理人 */
  title: string;
  /** three skill tags shown on the persona card */
  skills: [string, string, string];
  /** CSS border-radius of the avatar block (each persona has a unique shape) */
  avatarRadius: string;
  /** monogram text color on the avatar (most are white; 阿飞 uses douyin cyan) */
  monoColor: string;
}

export interface Platform {
  id: PlatformId;
  /** display name, e.g. 小红书 */
  name: string;
  /** platform brand color */
  color: string;
  /**
   * Color used where the raw brand color is too dark to read on the studio's
   * ink background (抖音 #161823 swaps to #FE2C55 for tabs/progress bars).
   */
  uiColor: string;
  /** content type produced for the platform, e.g. 种草笔记 */
  job: string;
  expert: Expert;
}

export type ChipSetId = "audience" | "platforms" | "style" | "materials";

export type StudioPhase =
  | "idle"
  | "audience"
  | "platform"
  | "style"
  | "materials"
  | "generating"
  | "done";

export interface Brief {
  goal: string;
  audience: string;
  platforms: PlatformId[];
  style: string;
  materials: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "ai";
  text: string;
  /** which chip set (quick replies) renders under this AI message */
  chipSet: ChipSetId | null;
  /** chips become non-interactive once the user moves past this step */
  locked: boolean;
}

export interface ExpertProgress extends Platform {
  /** 0–100 generation progress */
  pct: number;
}
