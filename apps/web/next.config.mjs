/** @type {import('next').NextConfig} */
const API_ORIGIN = process.env.API_BASE ?? 'http://127.0.0.1:3000';

const nextConfig = {
  reactStrictMode: true,
  turbopack: { root: '.' },
  // بسته‌ی هسته به‌صورتِ کدِ TypeScript منتشر می‌شود (بدونِ مرحله‌ی ساخت)؛
  // نکست باید آن را در کنارِ کدِ برنامه ترجمه کند.
  transpilePackages: ['@set/shared-kernel'],
  // هیچ دارایی‌ای از اینترنت بارگذاری نمی‌شود (الزامِ بخش AA)
  images: { unoptimized: true },
  allowedDevOrigins: ['*.e2b.app'],
  /**
   * بسته‌ها به شیوه‌ی ESM نوشته شده‌اند: در imports پسوندِ «.js» آمده است،
   * در حالی که فایل‌ها «.ts» هستند (قراردادِ استانداردِ Node برایِ ESM).
   * تی‌اس این را می‌فهمد، اما بسته‌بند نه؛ این یک خط آن را برایِ بسته‌بند
   * هم می‌فهماند — بدون اینکه کدِ بسته‌ها تغییر کند.
   */
  webpack: (config) => {
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      '.js': ['.ts', '.tsx', '.js'],
    };
    return config;
  },
  // مرورگر فقط با همینorigin (نسبی) صحبت می‌کند؛
  // درخواستِ /api/* در سرور به سرویسِ API پروکسی می‌شود.
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${API_ORIGIN}/:path*` }];
  },
};
export default nextConfig;
