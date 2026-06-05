import { View, Text, Button } from '@tarojs/components';
import Taro, { useShareAppMessage, useShareTimeline } from '@tarojs/taro';
import './index.scss';

export default function Home() {
  const goImport = () => Taro.switchTab({ url: '/pages/import/index' });
  const goProjects = () => Taro.switchTab({ url: '/pages/projects/index' });
  const goAbout = () => Taro.navigateTo({ url: '/pages/about/index' });

  const goNewBlank = () => {
    Taro.showActionSheet({
      itemList: ['52 × 52（中板）', '72 × 72', '104 × 104（大板）', '自定义尺寸…'],
      success: (res) => {
        const presets = [52, 72, 104];
        if (res.tapIndex < 3) {
          const s = presets[res.tapIndex];
          Taro.navigateTo({ url: `/pages/result/index?new=1&w=${s}&h=${s}` });
          return;
        }
        Taro.showModal({
          title: '自定义尺寸',
          editable: true,
          placeholderText: '宽×高，如 80x80（8-200）',
          content: '',
          success: (m) => {
            if (!m.confirm) return;
            const text = String((m as { content?: string }).content || '').trim().toLowerCase().replace(/[×*,]/g, 'x');
            const parts = text.split('x').map((s: string) => Number(s.trim()));
            const w = Math.max(8, Math.min(200, Math.floor(parts[0]) || 0));
            const h = Math.max(8, Math.min(200, Math.floor(parts[1]) || w));
            if (!w || !h) {
              Taro.showToast({ title: '尺寸无效', icon: 'none' });
              return;
            }
            Taro.navigateTo({ url: `/pages/result/index?new=1&w=${w}&h=${h}` });
          },
        } as Parameters<typeof Taro.showModal>[0]);
      },
    });
  };

  useShareAppMessage(() => ({
    title: '拼豆 · 一键把照片变成图纸',
    path: '/pages/home/index',
  }));

  useShareTimeline(() => ({
    title: '拼豆 · 一键把照片变成图纸',
    query: '',
  }));

  return (
    <View className="home">
      <View className="home__hero">
        <Text className="home__title">拼豆</Text>
        <Text className="home__subtitle">从照片到图纸</Text>
      </View>
      <Button className="home__cta" type="primary" onClick={goImport}>
        开始制作
      </Button>
      <Button className="home__cta home__cta--secondary" onClick={goNewBlank}>
        新建空白
      </Button>
      <View className="home__links">
        <Text className="home__link" onClick={goProjects}>我的作品</Text>
        <Text className="home__link-sep">·</Text>
        <Text className="home__link" onClick={goAbout}>关于</Text>
      </View>
    </View>
  );
}
