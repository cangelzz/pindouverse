import { View, Text, ScrollView } from '@tarojs/components';
import Taro, { useShareAppMessage, useShareTimeline } from '@tarojs/taro';
import './index.scss';

const VERSION = '1.2';

export default function About() {
  useShareAppMessage(() => ({
    title: '拼豆 · 一键把照片变成图纸',
    path: '/pages/home/index',
  }));

  useShareTimeline(() => ({
    title: '拼豆 · 一键把照片变成图纸',
    query: '',
  }));

  const clearAll = () => {
    Taro.showModal({
      title: '清空所有本地数据',
      content: '将删除所有保存的作品。此操作不可恢复，确定继续？',
      confirmText: '清空',
      confirmColor: '#ff5e62',
      success: (res) => {
        if (!res.confirm) return;
        try {
          Taro.removeStorageSync('pindou:projects');
          Taro.showToast({ title: '已清空', icon: 'success' });
        } catch {
          Taro.showToast({ title: '清空失败', icon: 'none' });
        }
      },
    });
  };

  return (
    <ScrollView className="about" scrollY>
      <View className="about__header">
        <Text className="about__logo">拼豆</Text>
        <Text className="about__version">v{VERSION}</Text>
      </View>

      <View className="about__section">
        <Text className="about__h2">这是什么</Text>
        <Text className="about__p">
          拼豆是一个把照片自动转换成 MARD221 拼豆图纸的小工具。导入一张图，选择尺寸与配色，就能得到可照着做的像素图纸。
        </Text>
      </View>

      <View className="about__section">
        <Text className="about__h2">主要功能</Text>
        <Text className="about__p">· 从相册或拍照导入图片</Text>
        <Text className="about__p">· 自动按 MARD221 色卡配色</Text>
        <Text className="about__p">· 编辑：画笔 / 橡皮 / 油漆桶 / 取色 / 拖动 / 撤销</Text>
        <Text className="about__p">· 本地保存作品、导出图纸到相册</Text>
        <Text className="about__p">· 分享给好友和朋友圈</Text>
      </View>

      <View className="about__section">
        <Text className="about__h2">隐私说明</Text>
        <Text className="about__p">
          所有作品仅保存在本机（小程序存储），不会上传到任何服务器。导入的图片只用于本地色彩匹配后即丢弃，不做留存或上传。
        </Text>
      </View>

      <View className="about__section about__section--danger">
        <Text className="about__h2">数据管理</Text>
        <View className="about__btn about__btn--danger" onClick={clearAll}>
          <Text className="about__btn-text">清空所有本地作品</Text>
        </View>
      </View>

      <View className="about__footer">
        <Text className="about__copyright">© Pindou</Text>
      </View>
    </ScrollView>
  );
}
