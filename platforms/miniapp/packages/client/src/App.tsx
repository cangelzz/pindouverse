import { useState } from 'react';
import type { CanvasData } from '@pindou/core';
import Home from './pages/Home';
import ImportPage from './pages/ImportPage';
import ResultPage from './pages/ResultPage';

type Page = 'home' | 'import' | 'result' | 'projects';

export default function App() {
  const [page, setPage] = useState<Page>('home');
  const [resultData, setResultData] = useState<{ data: CanvasData; w: number; h: number } | null>(null);

  const handleResult = (data: CanvasData, w: number, h: number) => {
    setResultData({ data, w, h });
    setPage('result');
  };

  switch (page) {
    case 'home':
      return <Home onNavigate={(p) => setPage(p as Page)} />;
    case 'import':
      return <ImportPage onResult={handleResult} onBack={() => setPage('home')} />;
    case 'result':
      return resultData ? (
        <ResultPage canvasData={resultData.data} width={resultData.w} height={resultData.h} onNew={() => setPage('import')} />
      ) : null;
    case 'projects':
      return (
        <div className="min-h-screen bg-white">
          <div className="bg-[#1a1a2e] text-white px-4 py-3 flex items-center">
            <button onClick={() => setPage('home')} className="mr-3 text-lg">←</button>
            <h2 className="text-lg font-semibold">我的作品</h2>
          </div>
          <div className="flex items-center justify-center h-64 text-gray-400">
            <p>暂无作品，快去创作吧！</p>
          </div>
        </div>
      );
    default:
      return null;
  }
}
