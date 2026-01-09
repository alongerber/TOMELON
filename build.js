/**
 * TOMELON Build Script
 * Minifies index.html (including inline CSS and JS) for production
 *
 * Usage: npm run build
 * Output: dist/index.html (minified version)
 */

const { minify } = require('html-minifier-terser');
const fs = require('fs');
const path = require('path');

const INPUT_FILE = 'index.html';
const OUTPUT_DIR = 'dist';
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'index.html');

// Minification options
const options = {
    // HTML options
    collapseWhitespace: true,
    removeComments: true,
    removeRedundantAttributes: true,
    removeEmptyAttributes: true,
    removeOptionalTags: false,

    // CSS options
    minifyCSS: true,

    // JS options
    minifyJS: {
        compress: {
            drop_console: false, // Keep console.log for debugging
            drop_debugger: true,
            pure_funcs: []
        },
        mangle: true
    }
};

async function build() {
    console.log('🚀 TOMELON Build Starting...\n');

    // Check if input file exists
    if (!fs.existsSync(INPUT_FILE)) {
        console.error(`❌ Error: ${INPUT_FILE} not found`);
        process.exit(1);
    }

    // Get original file size
    const originalSize = fs.statSync(INPUT_FILE).size;
    console.log(`📄 Original: ${INPUT_FILE} (${formatBytes(originalSize)})`);

    // Read the file
    const html = fs.readFileSync(INPUT_FILE, 'utf8');

    try {
        // Minify
        console.log('⚙️  Minifying HTML, CSS, and JavaScript...');
        const minified = await minify(html, options);

        // Create output directory if it doesn't exist
        if (!fs.existsSync(OUTPUT_DIR)) {
            fs.mkdirSync(OUTPUT_DIR, { recursive: true });
        }

        // Write minified file
        fs.writeFileSync(OUTPUT_FILE, minified);

        // Get new file size
        const newSize = fs.statSync(OUTPUT_FILE).size;
        const savings = originalSize - newSize;
        const percentage = ((savings / originalSize) * 100).toFixed(1);

        console.log(`\n✅ Build Complete!`);
        console.log(`📦 Output: ${OUTPUT_FILE} (${formatBytes(newSize)})`);
        console.log(`💾 Saved: ${formatBytes(savings)} (${percentage}% smaller)`);
        console.log(`\n📋 Next steps:`);
        console.log(`   1. Test dist/index.html locally`);
        console.log(`   2. Deploy the dist folder to production`);

        // Copy other necessary files to dist
        copyAssets();

    } catch (error) {
        console.error('❌ Minification Error:', error.message);
        process.exit(1);
    }
}

function copyAssets() {
    // List of files to copy to dist
    const assets = ['logo.png', 'api'];

    console.log(`\n📁 Copying assets...`);

    assets.forEach(asset => {
        const srcPath = path.join('.', asset);
        const destPath = path.join(OUTPUT_DIR, asset);

        if (fs.existsSync(srcPath)) {
            if (fs.statSync(srcPath).isDirectory()) {
                // Copy directory recursively
                copyDir(srcPath, destPath);
                console.log(`   ✓ ${asset}/ (directory)`);
            } else {
                // Copy file
                fs.copyFileSync(srcPath, destPath);
                console.log(`   ✓ ${asset}`);
            }
        }
    });
}

function copyDir(src, dest) {
    if (!fs.existsSync(dest)) {
        fs.mkdirSync(dest, { recursive: true });
    }

    const entries = fs.readdirSync(src, { withFileTypes: true });

    for (const entry of entries) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);

        if (entry.isDirectory()) {
            copyDir(srcPath, destPath);
        } else {
            fs.copyFileSync(srcPath, destPath);
        }
    }
}

function formatBytes(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

// Run build
build();
