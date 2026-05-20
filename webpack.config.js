const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');

module.exports = (env, argv) => {
  const isProd = argv.mode === 'production';
  return {
    entry: './src/index.tsx',
    output: {
      path: path.resolve(__dirname, 'dist/renderer'),
      filename: 'bundle.[contenthash].js',
      publicPath: '',
      clean: true,
    },
    resolve: {
      extensions: ['.tsx', '.ts', '.js'],
      alias: {
        '@': path.resolve(__dirname, 'src'),
      },
    },
    module: {
      rules: [
        { test: /\.tsx?$/, loader: 'ts-loader', exclude: /node_modules/ },
        { test: /\.css$/, use: ['style-loader', 'css-loader'] },
        { test: /\.(png|jpg|svg|woff2?)$/, type: 'asset/resource' },
      ],
    },
    plugins: [
      new HtmlWebpackPlugin({
        template: './src/index.html',
        inject: 'body',
      }),
    ],
    devServer: {
      static: path.join(__dirname, 'dist/renderer'),
      port: 9234,
      hot: true,
      historyApiFallback: true,
      headers: { 'Cache-Control': 'no-store' },
    },
    devtool: isProd ? false : 'eval-cheap-module-source-map',
  };
};
