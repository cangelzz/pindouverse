interface Props {
  onNavigate: (page: string) => void;
}

export default function Home({ onNavigate }: Props) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-b from-[#1a1a2e] to-[#16213e] text-white px-6">
      <div className="text-5xl mb-2">🫘</div>
      <h1 className="text-3xl font-bold mb-2">拼豆工坊</h1>
      <p className="text-gray-400 text-sm mb-10">图片转拼豆图纸，一键生成</p>

      <button
        onClick={() => onNavigate('import')}
        className="w-full max-w-xs py-3 rounded-xl bg-[#e94560] text-white text-lg font-semibold mb-4 active:bg-[#c73e54] transition"
      >
        开始创作
      </button>

      <button
        onClick={() => onNavigate('projects')}
        className="w-full max-w-xs py-3 rounded-xl border border-gray-500 text-gray-300 text-lg mb-8 active:bg-white/10 transition"
      >
        我的作品
      </button>

      <div className="text-center text-xs text-gray-500">
        <p className="mb-2">当前为游客模式，作品仅保存在本地</p>
        <button disabled className="px-4 py-1.5 rounded bg-[#07c160] text-white text-sm opacity-50 cursor-not-allowed">
          微信登录（即将开放）
        </button>
      </div>
    </div>
  );
}
