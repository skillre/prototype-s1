/**
 * zh-CN — S1 工作台的界面词典。
 *
 * Every user-visible string in the product lives here. Components never inline
 * copy: they read it through `useMessages()`. Adding a locale therefore means
 * adding one sibling file (`en-US.ts`) that satisfies the same shape — no
 * component needs to change.
 *
 * Conventions
 *   • Parameterised copy is a function, never string concatenation.
 *   • Keys describe meaning (`landing.pending.title`), not position.
 *   • Route slugs, code identifiers, keyboard shortcuts and brand names that
 *     are genuinely proper nouns stay as-is by design.
 *
 * 范围（与 Factory 的初始化边界一致）
 *   ✅ `components/**`  共享组件与外壳的默认文案（Sidebar / TopNav / Pagination /
 *                        OnboardingWizard / AiSummaryPanel / CommandPalette …）
 *   ✅ `app/**`         本产品自己的路由与 404
 *   ⛔ **不**包括业务记录内容 —— 那是数据，不是可翻译的文案。
 *
 * 这个文件属于初始化面（`init-contract.json` 的 `productFacing`）：它不得再出现
 * Reference Sample 或 Factory baseline 的产品身份。
 * `pnpm factory:init` 会逐字扫描它，而且**不区分代码与注释** —— 所以哪怕是解释
 * 「这里已经不含样例身份」的说明文字，也不能把那两个名字写出来。
 */
export const zhCN = {
  /* ------------------------------------------------------------------ meta */
  locale: {
    label: "简体中文",
    short: "中",
  },

  common: {
    cancel: "取消",
    close: "关闭",
    confirm: "确认",
    save: "保存",
    back: "返回",
    retry: "重试",
    reset: "重置",
    search: "搜索",
    searchPlaceholder: "搜索…",
    clearSearch: "清除搜索",
    resetFilters: "重置筛选",
    clearFilters: "清除筛选",
    loading: "加载中",
    loadFailed: "数据加载失败",
    copy: "复制",
    copied: "已复制",
    openMenu: "打开菜单",
    more: "更多",
    none: "暂无",
    notAvailable: "—",
  },

  /* --------------------------------------------------------------- 无障碍 */
  a11y: {
    primaryNav: "主导航",
    openNav: "打开导航",
    openCommand: "打开命令面板",
    commandHint: "搜索或运行命令",
    toggleTheme: "切换主题",
    refreshData: "刷新数据",
    notifications: "通知",
    accountMenu: "账户菜单",
    prototypeControls: "原型状态",
    backToTop: "回到顶部",
    sectionLabel: "工作区",
    skipToContent: "跳到主要内容",
  },

  /* ------------------------------------------------------------ 产品身份 */
  /**
   * S1 的身份。这里是品牌与文档元信息的**唯一**来源：
   * `app/layout.tsx` 的 metadata 读它，而不是各写一份字面量。
   */
  brand: {
    name: "S1",
    subtitle: "AI 原生安全运营工作台",
    mark: "S1",
    metaTitle: "S1 · AI 原生安全运营工作台",
    metaDescription:
      "面向保险公司安全团队的 SOC 控制台原型：AI 自主调查与闭环、人只在关键门授权、每条结论都能点开证据。",
  },

  /* --------------------------------------------------------------- 首屏 */
  /**
   * 首页文案。本轮的首页是**诚实的首屏**：说明这是什么产品、当前阶段的
   * 边界在哪里、下一步是什么 —— 不展示尚未实现的能力。
   * 因此下面每一段都标了「已完成 / 尚未开始」，改文案时不要把它们混起来。
   */
  landing: {
    eyebrow: "安全运营 · AI 原生工作台",
    title: "S1 工作台",
    description:
      "给保险公司安全团队用的 SOC 控制台。产品形态是 16:9 单屏不加滚动的三列战情室：左列攻击链实体视图，中列任务计划与研判流，右列处置授权与审计，底部常驻「问 S1」与流式报告。",

    /* 顶栏读数条：等宽读数，不是 hero。 */
    strip: {
      stageLabel: "阶段",
      stageValue: "初始化边界",
      stageNote: "组件层尚未实现",
      specLabel: "形态规格",
      specValue: "12 个组件 · 6 特征",
      specNote: "见设计稿实测与实现规格",
      visualLabel: "视觉方向",
      /* 不写 pack 的资产 id：产品源码里出现 id 会被 Kits 的 seam 门禁判违规
         （id 只能在 adapters/ 里出现，产品要的是「能力」不是「资产名」）。
         哪一套 pack 由 visual-manifest.json 与 lib/kits/kits.lock.json 回答。 */
      visualValue: "Kits 风格包",
      visualNote: "已安装 · 双主题接入",
    },

    done: {
      title: "本轮已完成",
      caption: "初始化边界（baseline → product）",
      items: [
        "身份重写：包名、metadata、首页、404 与词典都改成 S1 自己的，初始化面上不再有基线或样例的名字。",
        "Reference Sample 删除：CRM 路由、内置演示、样例样式层与只服务它们的测试全部移除，边界记在 init-contract.json。",
        "工厂门禁接上：初始化边界、策略、Visual Manifest、语义契约四道自查命令，加上 lint / typecheck / test / build / qa。",
        "端口与 QA 隔离：QA 端口 3310，自有 server 自起自停，绝不复用已经存在的进程。",
      ],
    },

    pending: {
      title: "尚未开始",
      caption: "以下都不是本仓现在的能力",
      items: [
        "十二个组件一个都没有实现：态势指挥条、任务计划、研判流、工具控制台、攻击链画布、处置授权区、审计时间线、问 S1、E+N 汇流视图、战果沉淀、顶栏花名册、报告流式生成。",
        "事件契约（8 类消息）与确定性回放器属于 S1 工单，本轮未开工。",
        "视觉方向已经落地：Kits 风格包由适配层接入深色主题；但签名组件预算是 0，能看到的仍然只有这一页。",
        "产品语义不变量尚未由人签署，product-contract.json 目前仍是基线那两条。",
      ],
    },

    spec: {
      title: "形态规格的六个特征",
      caption: "来自已签署的页面形态规格，是本轮之后的实现目标",
      features: [
        {
          title: "自主规划",
          detail: "任务计划由 Agent 自主拆解，并且留下重规划痕迹，而不是一条不会变的清单。",
        },
        {
          title: "工具调用",
          detail: "处置动作在堡垒机托管会话里执行，每条命令之前先给处置说明卡：依据、动作、影响、回滚。",
        },
        {
          title: "证据推理",
          detail: "每条结论都带证据引用与置信度，证据可以点开，不是一句无法追问的判断。",
        },
        {
          title: "分级授权",
          detail: "L0–L4 授权阶梯：低风险自动执行并留下回滚窗口，高风险挂起等人批准、驳回或改参数。",
        },
        {
          title: "记忆进化",
          detail: "每次事件都沉淀成剧本章节、基线策略与攻击者画像，下一次不必从零开始。",
        },
        {
          title: "主动汇报",
          detail: "处置报告流式生成，全程审计留痕可回放，人随时能问「谁批准了这次删除」。",
        },
      ],
    },

    boundary: {
      title: "交付边界",
      items: [
        "16:9 单屏不加滚动，滚动只发生在面板内部；移动视口不在产品形态里。",
        "本阶段是确定性回放：界面 100% 真实，命令不落到真实主机。",
        "演示编排（左屏、双屏投屏调度、真实攻防环境）不在本仓。",
        "纯前端：没有后端服务、没有数据库、没有鉴权，也不调用任何外部接口。",
      ],
    },

    commands: {
      title: "常用命令",
      items: [
        "pnpm dev --port 3310",
        "pnpm factory:init",
        "pnpm check",
      ],
    },

    footer: "S1 工作台原型 · 由 Prototype Factory 生产 · 前端 + 本地状态，无后端",
  },

  /**
   * 外壳（Sidebar / TopNav）里不属于某个具体页面的文案。
   * 这些字符串由**调用方**注入：共享组件本身不含任何产品身份。
   */
  shell: {
    workspaceSection: "工作台",
    live: "数据实时同步",
    liveAt: (time: string) => `最近同步 ${time}`,
    syncing: "正在同步…",
    accountHint: "打开个人资料",
    commandHint: "搜索或运行命令",
  },

  /** 通用分页文案——Pagination 的默认标签取这里，调用方无需重复传入。 */
  pagination: {
    nav: "分页",
    previous: "上一页",
    next: "下一页",
    page: (value: number) => `第 ${value} 页`,
    noResults: "暂无结果",
    range: (from: number, to: number, total: number) =>
      `第 ${from}–${to} 条，共 ${total} 条`,
  },

  /** 通用多步向导文案——OnboardingWizard 的默认文案。 */
  wizard: {
    title: "设置你的工作区",
    description: "一分钟即可完成设置，之后随时可以修改。",
    step: (index: number, total: number) => `第 ${index} 步，共 ${total} 步`,
    back: "上一步",
    next: "下一步",
    finish: "完成",
  },

  /* -------------------------------------------------- AI 摘要面板（共享组件） */
  aiSummary: {
    title: "AI 智能摘要",
    description: "基于这条记录确定性生成，不调用任何外部 API。",
    generate: "生成 AI 摘要",
    regenerate: "重新生成",
    generating: "生成中",
    generatingSr: "正在生成摘要…",
    idleHint: "还没有摘要。基于这条记录确定性生成一份简报。",
    recommendedNextStep: "建议的下一步",
    confidence: (value: number) => `置信度 ${value}%`,
    failed: "生成失败，请重试。",
  },

  /* ---------------------------------------------------------- 命令面板 */
  palette: {
    title: "命令面板",
    placeholder: "输入命令或搜索…",
    empty: "没有匹配的命令。",
    intelligence: "智能",
  },

  /* --------------------------------------------------------------- 通知 */
  notifications: {
    title: "通知",
    empty: "没有新通知了。",
    markAllRead: "全部标为已读",
    unreadCount: (count: number) => `${count} 条未读`,
  },

  /* ----------------------------------------------------------- 原型状态 */
  prototype: {
    title: "原型状态",
    description: "强制触发加载、错误与重置流程，预览所有状态。",
    simulateSlowLoad: "模拟慢加载",
    simulateFailure: "模拟接口失败",
    resetData: "重置原型数据",
    resetToastTitle: "原型数据已重置",
    resetToastDescription: "界面上的所有本地状态都已恢复初始值。",
  },

  /* ----------------------------------------------------------------- 提示 */
  toast: {
    refreshed: "数据已刷新",
    refreshFailed: "请求失败",
    refreshFailedDescription: "已切换到错误状态。",
    emailCopied: "邮箱已复制",
    clipboardUnavailable: "无法访问剪贴板",
    clipboardUnavailableDescription: "请授予剪贴板权限后重试。",
    notificationsRead: "已将全部通知标为已读",
    signedOut: "已退出登录",
    signedOutDescription: "本地会话状态已重置。",
  },

  /* ---------------------------------------------------------------- 浮层 */
  dialogs: {
    profile: {
      title: "个人资料",
      description: (workspace: string) => `你当前登录的是 ${workspace} 工作区。`,
      email: "邮箱",
      workspace: "工作区",
      role: "角色",
      plan: "版本",
    },
    signOut: {
      title: "确认退出登录？",
      description: (email?: string) =>
        `这是一个纯前端原型，没有真实鉴权。继续会把本地会话${
          email ? `（${email}）` : ""
        }恢复到初始状态——界面上的本地改动都会回到最初的样子。`,
      confirm: "退出登录",
    },
  },

  /* ------------------------------------------------------------------- 404 */
  notFound: {
    app: {
      metaTitle: "页面不存在",
      title: "这个页面不存在",
      description: "你访问的地址不属于这个原型，回到首页继续。",
      action: "返回首页",
      backHome: "返回首页",
    },
  },
}

/** Shape every locale must satisfy. */
export type Messages = typeof zhCN
