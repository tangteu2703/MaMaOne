// Node.js script to create icons using canvas
const fs = require('fs');
const path = require('path');

// Create icons directory if not exists
const iconsDir = path.join(__dirname, 'icons');
if (!fs.existsSync(iconsDir)) {
    fs.mkdirSync(iconsDir, { recursive: true });
}

console.log('📦 Creating extension icons...');
console.log('⚠️  Note: This script requires node-canvas package.');
console.log('   Install: npm install canvas');
console.log('');
console.log('💡 Alternative: Use create-icons.html in browser to generate icons');
console.log('   Or download from: https://via.placeholder.com/128/4CAF50/FFFFFF?text=↓');

// Simple SVG to PNG converter (if canvas not available)
function createSVGIcon(size) {
    return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${size}" height="${size}" fill="#4CAF50" rx="${size/8}"/>
  <g fill="white" stroke="white" stroke-width="${size/16}">
    <line x1="${size/2}" y1="${size/3}" x2="${size/2}" y2="${2*size/3}" stroke-linecap="round"/>
    <line x1="${size/2}" y1="${2*size/3}" x2="${size/3}" y2="${5*size/8}" stroke-linecap="round"/>
    <line x1="${size/2}" y1="${2*size/3}" x2="${2*size/3}" y2="${5*size/8}" stroke-linecap="round"/>
    <line x1="${size/3}" y1="${2*size/3}" x2="${2*size/3}" y2="${2*size/3}" stroke-linecap="round"/>
  </g>
</svg>`;
}

// Create SVG icons (can be converted to PNG later)
[16, 48, 128].forEach(size => {
    const svg = createSVGIcon(size);
    const svgPath = path.join(iconsDir, `icon${size}.svg`);
    fs.writeFileSync(svgPath, svg);
    console.log(`✅ Created icon${size}.svg`);
});

console.log('');
console.log('📝 Next steps:');
console.log('   1. Convert SVG to PNG using online tool: https://convertio.co/svg-png/');
console.log('   2. Or use create-icons.html in browser');
console.log('   3. Or manually create PNG files with green background (#4CAF50) and white download icon');

