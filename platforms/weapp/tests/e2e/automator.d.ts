// Type shims for miniprogram-automator (official package ships without TS types).
declare module 'miniprogram-automator' {
  export interface AutomatorLaunchOptions {
    /** Absolute path to compiled miniapp (the `dist/` folder). */
    projectPath: string;
    /** Absolute path to WeChat devtools cli. Required if not autodetected. */
    cliPath?: string;
    /** Automator port; default 9420. */
    port?: number;
    /** ProjectConfig overrides. */
    projectConfig?: Record<string, unknown>;
    /** Launch timeout in ms. */
    timeout?: number;
    /** Custom Account ID (appid). */
    account?: string;
    /** Path to runtime args. */
    runtime?: string;
  }

  export interface AutomatorConnectOptions {
    wsEndpoint: string;
  }

  export interface Element {
    tap(): Promise<void>;
    longpress(): Promise<void>;
    text(): Promise<string>;
    attribute(name: string): Promise<string>;
    property<T = unknown>(name: string): Promise<T>;
    callMethod<T = unknown>(method: string, ...args: unknown[]): Promise<T>;
    input(value: string): Promise<void>;
  }

  export interface Page {
    path: string;
    waitFor(condition: number | string | (() => boolean | Promise<boolean>)): Promise<void>;
    $(selector: string): Promise<Element | null>;
    $$(selector: string): Promise<Element[]>;
    data<T = unknown>(path?: string): Promise<T>;
    setData(data: Record<string, unknown>): Promise<void>;
    callMethod<T = unknown>(method: string, ...args: unknown[]): Promise<T>;
    size(): Promise<{ width: number; height: number }>;
  }

  export interface MiniProgram {
    currentPage(): Promise<Page>;
    navigateTo(url: string): Promise<Page>;
    redirectTo(url: string): Promise<Page>;
    reLaunch(url: string): Promise<Page>;
    switchTab(url: string): Promise<Page>;
    navigateBack(): Promise<Page>;
    pageStack(): Promise<Page[]>;
    evaluate<T = unknown>(fn: (...args: unknown[]) => T, ...args: unknown[]): Promise<T>;
    callWxMethod<T = unknown>(method: string, ...args: unknown[]): Promise<T>;
    mockWxMethod(method: string, result: unknown): Promise<void>;
    restoreWxMethod(method: string): Promise<void>;
    close(): Promise<void>;
    disconnect(): Promise<void>;
  }

  export function launch(options: AutomatorLaunchOptions): Promise<MiniProgram>;
  export function connect(options: AutomatorConnectOptions): Promise<MiniProgram>;
}
