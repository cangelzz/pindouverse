import path from 'node:path';

const config = {
  projectName: 'pindou-weapp',
  date: '2026-05-29',
  designWidth: 750,
  deviceRatio: {
    640: 2.34 / 2,
    750: 1,
    828: 1.81 / 2,
  },
  sourceRoot: 'src',
  outputRoot: 'dist',
  plugins: [],
  defineConstants: {},
  copy: {
    patterns: [],
    options: {},
  },
  framework: 'react',
  compiler: {
    type: 'webpack5',
    prebundle: { enable: false },
  },
  cache: {
    enable: false,
  },
  mini: {
    compile: {
      include: [
        path.resolve(__dirname, '..', '..', 'h5', 'packages', 'core'),
      ],
    },
    postcss: {
      pxtransform: { enable: true, config: {} },
      url: { enable: true, config: { limit: 1024 } },
      cssModules: { enable: false, config: { namingPattern: 'module', generateScopedName: '[name]__[local]___[hash:base64:5]' } },
    },
  },
  h5: {
    publicPath: '/',
    staticDirectory: 'static',
    postcss: {
      autoprefixer: { enable: true, config: {} },
      cssModules: { enable: false, config: { namingPattern: 'module', generateScopedName: '[name]__[local]___[hash:base64:5]' } },
    },
  },
  alias: {
    '@': path.resolve(__dirname, '..', 'src'),
  },
};

export default async function (merge: (..._args: unknown[]) => unknown) {
  if (process.env.NODE_ENV === 'development') {
    return merge({}, config, (await import('./dev')).default);
  }
  return merge({}, config, (await import('./prod')).default);
}
