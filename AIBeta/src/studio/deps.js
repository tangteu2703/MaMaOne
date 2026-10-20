// ==========================================
// STUDIO / DEPS
// Phụ thuộc được tiêm từ server.js (tránh require vòng tròn)
// ==========================================
module.exports = {
  imageProviders: null,
  imageStyles: null,
  port: 3000,
  zerottsUrl: () => process.env.ZEROTTS_URL || 'http://localhost:7860',
  init({ imageProviders, imageStyles, port }) {
    this.imageProviders = imageProviders;
    this.imageStyles = imageStyles;
    if (port) this.port = port;
  },
};
