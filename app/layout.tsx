import type { CSSProperties } from "react";
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { LocaleProvider } from "@/components/i18n/locale-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { DEFAULT_LOCALE, messages } from "@/lib/i18n";
import { stylePackMeta, stylePackMotionVars } from "@/lib/kits/adapters/style-pack";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

/**
 * 身份来自词典，不在这里再写一份字面量。
 *
 * `lib/i18n/zh-CN.ts` 的 `brand.*` 是产品身份的唯一来源，而它属于初始化面：
 * `pnpm factory:init` 会逐字扫描它，确认 baseline 与 Reference Sample 的名字
 * 都没有留下（那个检查会在比较前剥掉注释，但「必须消失的名字」也没必要写在注释里）。
 */
export const metadata: Metadata = {
  title: { default: messages.brand.metaTitle, template: `%s · ${messages.brand.name}` },
  description: messages.brand.metaDescription,
};

// 在水合前应用主题 class，避免闪烁。
// 由 Server Component 输出 <script>（客户端组件内渲染 script 会有 React 告警）。
const themeScript = `(function(){try{var t=localStorage.getItem("theme");var d=t==="dark"||((!t||t==="system")&&window.matchMedia("(prefers-color-scheme: dark)").matches);var r=document.documentElement;r.classList.toggle("dark",d);r.style.colorScheme=d?"dark":"light"}catch(e){}})();`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang={DEFAULT_LOCALE}
      suppressHydrationWarning
      /*
        Style Pack 作用域。Kits 的取值全部写在 `[data-kits-pack="console"]` 里，
        所以页面必须声明一次；放在 <html> 上的原因是：对话框 / 抽屉 / toast 都通过
        portal 挂到 body 层，声明在页面容器里会让它们拿不到 pack 取值。

        取值来自适配层（stylePackMeta.id），不在这里写字面量 —— 「当前是哪一套」
        只有一个来源，换 pack 时产品不会与适配层脱钩。
      */
      data-kits-pack={stylePackMeta.id}
      /*
        动效刻度由 pack 的 motion.ts 经 Kits 自己的 motionToCssVars() 编译而来
        （见 lib/kits/adapters/style-pack.ts），不是产品手抄的映射表。
        SSR 阶段即可序列化 → 没有 hydration 差异。
      */
      style={stylePackMotionVars as CSSProperties}
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <script suppressHydrationWarning dangerouslySetInnerHTML={{ __html: themeScript }} />
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          {/* 语言环境：默认 zh-CN。所有界面文案经 useMessages() 读取，见 lib/i18n。 */}
          <LocaleProvider locale={DEFAULT_LOCALE}>
            <TooltipProvider delay={300}>{children}</TooltipProvider>
            {/*
              通知固定在右下角：顶栏右上是账户菜单、通知铃铛与原型状态，
              top-right 的 toast 会直接盖住这些全局控件并拦截点击。
            */}
            <Toaster
              richColors
              position="bottom-right"
              closeButton
              toastOptions={{ className: "font-sans" }}
            />
          </LocaleProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
