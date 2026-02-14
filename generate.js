#!/usr/bin/env node
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const { svgPathProperties } = require('svg-path-properties');
const GIFEncoder = require('gif-encoder-2');

const inputDir = path.join(__dirname, 'kanji_svg');
const outputDirSquare = path.join(__dirname, 'kanji_png');
const outputDirOg = path.join(__dirname, 'kanji_png_og');
const outputDirGif = path.join(__dirname, 'kanji_gif');

// --- Helper: Argument Parsing ---
function parseArgs() {
    const args = process.argv.slice(2);
    const config = {
        help: false,
        file: null,
        mode: 'default', // 'default' or 'custom'
        format: null,    // 'png' or 'gif'
        width: null,
        height: null,
        outDir: null,
        bg: 'white',     // 'white', 'transparent', or hex
        color: '#000000', // Stroke color
        guide: '#dddddd', // Guide color (or 'none')
        duration: 2000,  // ms (default for fixed)
        fps: 20,
        timing: 'fixed', // 'fixed', 'relative'
        strokeDuration: 200, // ms per stroke (for relative timing)
    };

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === '--help' || arg === '-h') {
            config.help = true;
            return config; // Early exit
        }
        if (arg === '--file') {
            config.file = args[++i];
        } else if (arg === '--format') {
            config.format = args[++i].toLowerCase();
            config.mode = 'custom';
        } else if (arg === '--width') {
            const val = args[++i];
            if (!val || val.startsWith('-')) {
                console.error('Error: --width requires a value');
                process.exit(1);
            }
            config.width = parseInt(val);
            config.mode = 'custom';
        } else if (arg === '--height') {
            const val = args[++i];
            if (!val || val.startsWith('-')) {
                console.error('Error: --height requires a value');
                process.exit(1);
            }
            config.height = parseInt(val);
            config.mode = 'custom';
        } else if (arg === '--out') {
            config.outDir = args[++i];
            config.mode = 'custom';
        } else if (arg === '--bg') {
            config.bg = args[++i];
            config.mode = 'custom';
        } else if (arg === '--color') {
            config.color = args[++i];
            config.mode = 'custom';
        } else if (arg === '--guide') {
            config.guide = args[++i];
            config.mode = 'custom';
        } else if (arg === '--duration') {
            const val = args[++i];
            if (!val || val.startsWith('-')) {
                console.error('Error: --duration requires a value');
                process.exit(1);
            }
            config.duration = parseInt(val);
            config.mode = 'custom';
        } else if (arg === '--fps') {
            const val = args[++i];
            if (!val || val.startsWith('-')) {
                console.error('Error: --fps requires a value');
                process.exit(1);
            }
            config.fps = parseInt(val);
            config.mode = 'custom';
        } else if (arg === '--timing') {
            config.timing = args[++i].toLowerCase();
            config.mode = 'custom';
        } else if (arg === '--kanji' || arg === '-k') {
            const val = args[++i];
            if (!val || val.startsWith('-')) {
                console.error('Error: --kanji requires a character');
                process.exit(1);
            }
            // Convert char to hex code
            const code = val.codePointAt(0).toString(16).toLowerCase();
            const hex = code.padStart(5, '0');
            config.file = `${hex}.svg`;
        }
    }

    // Default Height if Width is set but Height is not
    if (config.width && !config.height) config.height = config.width;
    // Default Width if Height is set but Width is not
    if (config.height && !config.width) config.width = config.height;

    // Default output dir for custom mode
    if (config.mode === 'custom' && !config.outDir) {
        config.outDir = path.join(process.cwd(), 'kanji_custom');
    }

    return config;
}

function printHelp() {
    console.log(`
Usage: node generate.js [options]

Modes:
  Default (no args): Generates Square PNG, OG PNG, and Animated GIF.
  Custom: Generates a specific format with custom settings.

Options:
  --help, -h       Show this help message.
  --help, -h       Show this help message.
  --file <name>    Process a single SVG file (e.g., 04e00.svg).
  --kanji, -k <char> Process a single Kanji character (e.g., 一).

Customization Options:
  --format <type>  Output format: 'png' or 'gif'.
  --width <px>     Output width.
  --height <px>    Output height. (Defaults to width if omitted).
  --out <dir>      Output directory (default: 'kanji_custom').
  --bg <color>     Background color (e.g., 'white', 'transparent' or '#RRGGBB'). 
                   Default: 'white' (GIF/PNG), 'transparent' (Square PNG in default mode).
  --color <hex>    Main stroke color (default: '#000000').
  --guide <hex>    Guide stroke color (default: '#dddddd', use 'none' to hide).
  
Animation Options (GIF only):
  --duration <ms>  Total animation duration (default: 2000ms).
  --fps <num>      Frames per second (default: 20).
  --timing <mode>  'fixed' (default) or 'relative'.
                   fixed: All kanji take 'duration' ms.
                   relative: Duration depends on stroke count.

Examples:
  node generate.js --file 04e00.svg --format gif --width 300 --timing relative --color red
  node generate.js --format png --width 500 --bg transparent --guide none
`);
}

// --- Logic: Core Processing ---

function preprocessSvg(content) {
    // Remove DOCTYPE/comments before <svg
    const svgStart = content.indexOf('<svg');
    if (svgStart > 0) {
        content = content.substring(svgStart);
    }
    // Inject kvg namespace if missing
    if (!content.includes('xmlns:kvg')) {
        content = content.replace('<svg', '<svg xmlns:kvg="http://kanjivg.tagaini.net"');
    }
    return content;
}

// Generates a static PNG (Custom or Default modes)
async function generatePng(svgBuffer, outputPath, width, height, fit, background, color, guide) {
    // Sharp can't easily change SVG stroke colors on the fly unless we manipulate the SVG buffer first.
    // So we should manipulate the buffer if custom colors are needed.
    // However, since we already have cheerio loaded in generateGif, maybe we should use it here too if needed?
    // Or just simple string replacement for standard black strokes?
    // Given we are already using Cheerio for GIF, let's use it for PNG resizing too if we need to recolor.

    // BUT efficient batch processing for default Mode 1/2 shouldn't parse everything.
    // Only parse if custom color is requested? 
    // Actually, `generatePng` is called with `color` arg.

    let bufferToUse = svgBuffer;

    // If we need to modify colors:
    // (Note: Default strokes are black. Guide is usually not in the main SVG unless we add it?)
    // Wait, the main SVG `kanji_svg` ONLY contains the strokes. It doesn't contain a guide.
    // The "Guide" in GIF mode is generated by us drawing the full paths in grey first.
    // So for PNG: 
    // - If it's the main stroke, proper color application is needed.
    // - There is NO guide in the static PNG usually.

    if (color && color !== '#000000') {
        const svgString = svgBuffer.toString('utf8');
        // Simple regex replace for stroke:#000000 -> stroke:color might work if consistent.
        // KanjiVG usually has style="fill:none;stroke:#000000;..."
        const newSvg = svgString.replace(/stroke:#000000/g, `stroke:${color}`);
        bufferToUse = Buffer.from(newSvg);
    }

    await sharp(bufferToUse)
        .resize({
            width: width,
            height: height,
            fit: fit,
            background: background
        })
        .png()
        .toFile(outputPath);
}

// Generates Animated GIF
async function generateGif(svgContent, outputPath, width, height, options) {
    const $ = cheerio.load(svgContent, { xmlMode: true });
    const paths = [];

    // Extract paths
    $('path').each((i, el) => {
        const d = $(el).attr('d');
        if (d) {
            paths.push({
                d: d,
                id: $(el).attr('id')
            });
        }
    });

    if (paths.length === 0) return;

    // Calculate lengths
    const pathProps = paths.map(p => {
        const props = new svgPathProperties(p.d);
        return { ...p, length: props.getTotalLength() };
    });

    const totalLength = pathProps.reduce((sum, p) => sum + p.length, 0);

    // Determine Duration
    let animationDuration = options.duration;
    if (options.timing === 'relative') {
        // e.g., 200ms per stroke, plus a base time of 500ms?
        // Or just scaled by count. User said "each stroke take equal time".
        // Let's say 1 stroke = 500ms? That's slow.
        // Let's use a base relative speed. 
        // If fixed default is 2000ms.
        // Relative: maybe 300ms PER stroke?
        // Complex kanji (20 strokes) = 6000ms (6s).
        // Simple kanji (1 stroke) = 300ms (too fast?).
        // Let's impose a minimum: Math.max(1000, strokes * 300)?
        // For now, let's stick to strict linear per stroke if requested.
        // Or better: Base 500ms + (Strokes * 200ms).
        const timePerStroke = 200; // ms
        const baseTime = 500;
        animationDuration = baseTime + (pathProps.length * timePerStroke);
    }

    const fps = options.fps;
    const totalFrames = Math.ceil((animationDuration / 1000) * fps);

    // Setup Encoder
    const encoder = new GIFEncoder(width, height);
    encoder.createReadStream().pipe(fs.createWriteStream(outputPath));
    encoder.start();
    encoder.setRepeat(0);
    encoder.setDelay(1000 / fps);
    encoder.setQuality(10);
    // Determine background color
    // Sharp needs an object/string for background.
    // If 'transparent', GIFEncoder might have issues unless we handle transparency index.
    // GIFEncoder-2 supports transparency but it's tricky.
    // For now, if bg is 'transparent', we pass alpha 0 to sharp, and tell encoder?
    // gif-encoder-2 documentation says: encoder.setTransparent(colorHex) to set which color is transparent.
    // This is getting complex. Let's stick to: if bg is transparent, we assume white/black matte?
    // Actually, usually GIFs are white bg.
    // Let's interpret 'transparent' as 'rgba(0,0,0,0)' for Sharp.
    // But `gif-encoder-2` handles RGBA buffers? Yes.
    // If usage implies web display, transparent GIF is nice.
    // Let's rely on Sharp ensuring alpha.

    let sharpBg = options.bg === 'transparent' ? { r: 0, g: 0, b: 0, alpha: 0 } : options.bg;
    const strokeColor = options.color || '#000000';
    const guideColor = options.guide || '#dddddd';
    const showGuide = options.guide !== 'none';

    // Render frames
    // Hold final state for 1 second (fps frames)
    const endPauseFrames = fps;

    for (let frame = 0; frame < totalFrames + endPauseFrames; frame++) {
        let currentTotalProgress = (frame / totalFrames) * totalLength;
        if (frame >= totalFrames) currentTotalProgress = totalLength;

        // Build SVG for this frame
        let frameSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="109" height="109" viewBox="0 0 109 109">`;

        // No rect background in SVG itself if we want transparent/controlled via Sharp

        // Ghost strokes (light grey)
        if (showGuide) {
            frameSvg += `<g stroke="${guideColor}" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round">`;
            paths.forEach(p => {
                frameSvg += `<path d="${p.d}"/>`;
            });
            frameSvg += `</g>`;
        }

        // Active strokes (black)
        frameSvg += `<g stroke="${strokeColor}" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round">`;

        let drawnLength = 0;
        for (let p of pathProps) {
            if (drawnLength + p.length <= currentTotalProgress) {
                frameSvg += `<path d="${p.d}"/>`;
                drawnLength += p.length;
            } else if (drawnLength < currentTotalProgress) {
                const partLength = currentTotalProgress - drawnLength;
                frameSvg += `<path d="${p.d}" stroke-dasharray="${partLength} ${p.length}" stroke-dashoffset="0"/>`;
                drawnLength += p.length;
                break;
            } else {
                break;
            }
        }
        frameSvg += `</g></svg>`;

        // Render frame
        // Render frame
        let sharpInstance = sharp(Buffer.from(frameSvg))
            .resize(width, height, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } });

        // Apply background color if not transparent
        // Use flatten() which is much faster than composite for solid backgrounds
        if (options.bg !== 'transparent') {
            sharpInstance = sharpInstance.flatten({ background: sharpBg });
        }

        const buffer = await sharpInstance
            .ensureAlpha()
            .raw()
            .toBuffer();

        encoder.addFrame(buffer);
    }

    encoder.finish();
}

async function processFile(file, config) {
    const inputPath = path.join(inputDir, file);

    try {
        let content = fs.readFileSync(inputPath, 'utf8');
        content = preprocessSvg(content);
        const svgBuffer = Buffer.from(content);

        // --- Custom Mode ---
        if (config.mode === 'custom') {
            const outDir = config.outDir;
            if (!fs.existsSync(outDir)) {
                fs.mkdirSync(outDir, { recursive: true });
            }

            const basename = file.replace('.svg', '');

            if (config.format === 'png') {
                const width = config.width || 1024;
                const height = config.height || 1024;
                const outFile = path.join(outDir, `${basename}.png`);
                // Note: bg logic handled inside generatePng via 'background' option of resize
                // Map config.bg to sharp color
                const bg = config.bg === 'transparent' ? { r: 0, g: 0, b: 0, alpha: 0 } : config.bg;

                await generatePng(svgBuffer, outFile, width, height, 'contain', bg, config.color, config.guide);
                // console.log(`Generated Custom PNG: ${outFile}`);
            }
            else if (config.format === 'gif') {
                const width = config.width || 200;
                const height = config.height || 200;
                const outFile = path.join(outDir, `${basename}.gif`);

                await generateGif(content, outFile, width, height, {
                    duration: config.duration,
                    fps: config.fps,
                    timing: config.timing,
                    bg: config.bg,
                    color: config.color,
                    guide: config.guide
                });
                // console.log(`Generated Custom GIF: ${outFile}`);
            }

        }
        // --- Default Mode (3 outputs) ---
        else {
            // Ensure default directories exist
            [outputDirSquare, outputDirOg, outputDirGif].forEach(dir => {
                if (!fs.existsSync(dir)) {
                    fs.mkdirSync(dir, { recursive: true });
                }
            });
            // 1. Square PNG
            const sqPath = path.join(outputDirSquare, file.replace('.svg', '.png'));
            await generatePng(svgBuffer, sqPath, 1024, 1024, 'contain', { r: 0, g: 0, b: 0, alpha: 0 }, '#000000', 'none');

            // 2. OG Image
            const ogPath = path.join(outputDirOg, file.replace('.svg', '.png'));
            const kanjiBuffer = await sharp(svgBuffer)
                .resize({ height: 500, fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
                .png()
                .toBuffer();

            // Composite on White 1200x630
            await sharp({
                create: { width: 1200, height: 630, channels: 4, background: 'white' }
            })
                .composite([{ input: kanjiBuffer, gravity: 'center' }])
                .png()
                .toFile(ogPath);

            // 3. Animated GIF (standard settings)
            const gifPath = path.join(outputDirGif, file.replace('.svg', '.gif'));
            await generateGif(content, gifPath, 200, 200, {
                duration: 2000,
                fps: 20,
                timing: 'fixed',
                bg: 'white',
                color: '#000000',
                guide: '#dddddd'
            });
        }

    } catch (err) {
        console.error(`Error processing ${file}:`, err);
    }
}

async function main() {
    try {
        const config = parseArgs();

        if (config.help) {
            printHelp();
            return;
        }

        // Check if input directory exists
        if (!fs.existsSync(inputDir)) {
            console.error(`Input directory not found: ${inputDir}`);
            return;
        }

        let files = [];
        if (config.file) {
            let filePath = path.join(inputDir, config.file);
            if (!fs.existsSync(filePath)) {
                // Try appending .svg
                if (fs.existsSync(filePath + '.svg')) {
                    config.file += '.svg';
                }
                // Try padding to 5 digits + .svg (e.g., 6f22 -> 06f22.svg)
                else {
                    const padded = config.file.padStart(5, '0') + '.svg';
                    if (fs.existsSync(path.join(inputDir, padded))) {
                        config.file = padded;
                    } else {
                        console.error(`File ${config.file} (or ${config.file}.svg, ${padded}) not found.`);
                        return;
                    }
                }
            }
            files = [config.file];
        } else {
            files = fs.readdirSync(inputDir).filter(file => file.endsWith('.svg'));
        }

        console.log(`Processing ${files.length} file(s). Mode: ${config.mode.toUpperCase()}`);
        if (config.mode === 'custom') {
            console.log(`Settings: Format=${config.format || 'N/A'}, Size=${config.width}x${config.height}, Timing=${config.timing}`);
        }

        // Process in batches
        const batchSize = 20;
        for (let i = 0; i < files.length; i += batchSize) {
            const batch = files.slice(i, i + batchSize);
            await Promise.all(batch.map(f => processFile(f, config)));
            if (files.length > 20) {
                console.log(`Processed ${Math.min(i + batchSize, files.length)} / ${files.length}`);
            }
        }

        console.log('All done! ✨');

    } catch (err) {
        console.error("Fatal error:", err);
    }
}

main();