export default defineAppConfig({
  pages: [
    'pages/home/index',
    'pages/import/index',
    'pages/projects/index',
    'pages/result/index',
    'pages/about/index',
  ],
  window: {
    backgroundTextStyle: 'light',
    navigationBarBackgroundColor: '#ffffff',
    navigationBarTitleText: '拼豆',
    navigationBarTextStyle: 'black',
  },
  tabBar: {
    color: '#7a7a7a',
    selectedColor: '#ff7043',
    backgroundColor: '#ffffff',
    borderStyle: 'black',
    list: [
      {
        pagePath: 'pages/home/index',
        text: '首页',
        iconPath: 'assets/tab/home.png',
        selectedIconPath: 'assets/tab/home-active.png',
      },
      {
        pagePath: 'pages/import/index',
        text: '导入',
        iconPath: 'assets/tab/import.png',
        selectedIconPath: 'assets/tab/import-active.png',
      },
      {
        pagePath: 'pages/projects/index',
        text: '我的',
        iconPath: 'assets/tab/me.png',
        selectedIconPath: 'assets/tab/me-active.png',
      },
    ],
  },
});
