// Node.js Backend Service để gọi yt-dlp
const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Store active downloads
const activeDownloads = new Map();

// Find yt-dlp executable
function findYtDlp() {
    // Check if yt-dlp is in PATH
    return new Promise((resolve) => {
        const checkProcess = spawn('yt-dlp', ['--version'], {
            shell: true,
            stdio: 'pipe'
        });

        checkProcess.on('close', (code) => {
            if (code === 0) {
                resolve('yt-dlp');
            } else {
                // Check common Python paths
                const pythonPaths = [
                    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Python'),
                    path.join(process.env.APPDATA || '', 'Local', 'Programs', 'Python'),
                    'C:\\Python'
                ];

                for (const basePath of pythonPaths) {
                    if (fs.existsSync(basePath)) {
                        const dirs = fs.readdirSync(basePath).filter(d => d.startsWith('Python'));
                        for (const dir of dirs) {
                            const ytDlpPath = path.join(basePath, dir, 'Scripts', 'yt-dlp.exe');
                            if (fs.existsSync(ytDlpPath)) {
                                resolve(ytDlpPath);
                                return;
                            }
                        }
                    }
                }
                resolve(null);
            }
        });
    });
}

// Download endpoint
app.post('/api/download', async (req, res) => {
    const { url, path: savePath } = req.body;

    if (!url) {
        return res.status(400).json({ error: 'URL is required' });
    }

    const downloadId = Date.now().toString();
    const outputPath = savePath || path.join(process.env.USERPROFILE || '', 'Downloads');

    try {
        const ytDlpPath = await findYtDlp();
        if (!ytDlpPath) {
            return res.status(500).json({ 
                error: 'yt-dlp not found. Please install: pip install yt-dlp' 
            });
        }

        // Setup SSE (Server-Sent Events) for progress
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        const outputTemplate = path.join(outputPath, '%(title)s.%(ext)s');
        const args = [
            '-o', outputTemplate,
            '--newline',
            '--progress',
            url
        ];

        const ytDlpProcess = spawn(ytDlpPath, args, {
            shell: true,
            cwd: outputPath
        });

        activeDownloads.set(downloadId, ytDlpProcess);

        // Send progress updates
        ytDlpProcess.stdout.on('data', (data) => {
            const lines = data.toString().split('\n').filter(line => line.trim());
            for (const line of lines) {
                res.write(`data: ${JSON.stringify({ type: 'progress', data: line })}\n\n`);
            }
        });

        ytDlpProcess.stderr.on('data', (data) => {
            const error = data.toString();
            res.write(`data: ${JSON.stringify({ type: 'error', data: error })}\n\n`);
        });

        ytDlpProcess.on('close', (code) => {
            activeDownloads.delete(downloadId);
            if (code === 0) {
                res.write(`data: ${JSON.stringify({ type: 'complete' })}\n\n`);
            } else {
                res.write(`data: ${JSON.stringify({ type: 'error', data: `Process exited with code ${code}` })}\n\n`);
            }
            res.end();
        });

        // Handle client disconnect
        req.on('close', () => {
            if (activeDownloads.has(downloadId)) {
                ytDlpProcess.kill();
                activeDownloads.delete(downloadId);
            }
        });

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', message: 'Video Downloader API is running' });
});

// Start server
app.listen(PORT, () => {
    console.log(`🚀 Video Downloader Backend running on http://localhost:${PORT}`);
    console.log(`📦 Make sure yt-dlp is installed: pip install yt-dlp`);
});

