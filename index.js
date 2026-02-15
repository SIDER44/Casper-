const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const qrcode = require('qrcode');
const express = require('express');
const fs = require('fs');
const path = require('path');
const pino = require('pino');

const app = express();
const PORT = process.env.PORT || 3000;

// Better logging
const logger = pino({ level: 'info' });

let connectionStatus = 'disconnected';
let latestQR = null;
let sock = null;
const SESSION_DIR = path.join(__dirname, 'auth_info');

// Ensure session directory exists
if (!fs.existsSync(SESSION_DIR)) {
    fs.mkdirSync(SESSION_DIR, { recursive: true });
}

// Simple status page
app.get('/', (req, res) => {
    let qrHTML = '';
    if (latestQR && connectionStatus === 'awaiting_scan') {
        qrHTML = `
            <div style="margin:20px 0">
                <h3>📱 Scan QR Code with WhatsApp</h3>
                <img src="${latestQR}" style="width:250px;height:250px"/>
                <p>1. Open WhatsApp > Menu > Linked Devices</p>
                <p>2. Tap "Link a Device"</p>
                <p>3. Scan this QR code</p>
            </div>
        `;
    }
    
    res.send(`
        <html>
        <head><title>Casper WhatsApp Bot</title>
        <meta http-equiv="refresh" content="5">
        <style>
            body { font-family:Arial; text-align:center; padding:20px; background:#f0f2f5; }
            .card { background:white; padding:30px; border-radius:15px; max-width:500px; margin:0 auto; }
            .status { padding:15px; border-radius:10px; margin:20px 0; }
            .connected { background:#d4edda; color:#155724; }
            .awaiting { background:#fff3cd; color:#856404; }
            .disconnected { background:#f8d7da; color:#721c24; }
        </style>
        </head>
        <body>
            <div class="card">
                <h1>🤖 Casper Bot</h1>
                <div class="status ${connectionStatus}">
                    Status: ${connectionStatus === 'connected' ? '✅ Connected' : 
                              connectionStatus === 'awaiting_scan' ? '📱 Ready to scan' : 
                              '⏳ Initializing...'}
                </div>
                ${qrHTML}
                <p style="color:#666;font-size:12px">Running on Railway ✅</p>
            </div>
        </body>
        </html>
    `);
});

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', connection: connectionStatus });
});

// WhatsApp connection with retry logic
async function connectToWhatsApp() {
    console.log('🤖 Starting Casper bot...');
    
    try {
        const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
        
        sock = makeWASocket({
            auth: state,
            printQRInTerminal: false,
            browser: ['Casper Bot', 'Chrome', '1.0.0'],
            logger: logger,
            syncFullHistory: false,
            markOnlineOnConnect: true,
            // Critical: Add connection timeout
            connectTimeoutMs: 60000,
            // Keep connection alive
            keepAliveIntervalMs: 25000,
            // Retry mechanism
            retryRequestDelayMs: 500
        });

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;
            
            if (qr) {
                try {
                    latestQR = await qrcode.toDataURL(qr);
                    connectionStatus = 'awaiting_scan';
                    console.log('📱 QR Code generated - Scan with WhatsApp');
                } catch (err) {
                    console.error('QR generation error:', err);
                }
            }
            
            if (connection === 'open') {
                console.log('✅ Casper connected successfully!');
                console.log('👤 Phone:', sock.user?.id);
                connectionStatus = 'connected';
                latestQR = null;
            }
            
            if (connection === 'close') {
                const shouldReconnect = (lastDisconnect?.error instanceof Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
                console.log('❌ Connection closed:', lastDisconnect?.error?.message);
                
                connectionStatus = 'disconnected';
                
                if (shouldReconnect) {
                    console.log('🔄 Reconnecting in 5 seconds...');
                    setTimeout(connectToWhatsApp, 5000);
                } else {
                    console.log('🔐 Logged out. Delete auth folder and restart.');
                    // Clean up session
                    fs.rmSync(SESSION_DIR, { recursive: true, force: true });
                    fs.mkdirSync(SESSION_DIR, { recursive: true });
                    setTimeout(connectToWhatsApp, 10000);
                }
            }
        });

        sock.ev.on('creds.update', saveCreds);

        // Handle messages
        sock.ev.on('messages.upsert', async ({ messages }) => {
            const msg = messages[0];
            if (!msg.message || msg.key.fromMe) return;
            
            let text = '';
            if (msg.message.conversation) text = msg.message.conversation;
            else if (msg.message.extendedTextMessage) text = msg.message.extendedTextMessage.text;
            
            if (!text) return;
            
            const sender = msg.key.remoteJid;
            const cmd = text.toLowerCase().trim();
            
            console.log(`📨 Message: ${cmd}`);
            
            if (cmd === '!ping' || cmd === 'ping') {
                await sock.sendMessage(sender, { text: '🏓 Pong! Casper is online!' });
            }
            else if (cmd === '!hello' || cmd === 'hello' || cmd === 'hi') {
                await sock.sendMessage(sender, { text: `👋 Hello! I'm Casper 🤖` });
            }
            else if (cmd === '!time' || cmd === 'time') {
                const now = new Date().toLocaleString();
                await sock.sendMessage(sender, { text: `🕐 ${now}` });
            }
            else if (cmd === '!help' || cmd === 'help') {
                await sock.sendMessage(sender, { 
                    text: `🤖 *Casper Commands*\n\n• !ping - Check bot\n• !hello - Greeting\n• !time - Current time\n• !help - This menu` 
                });
            }
        });

    } catch (error) {
        console.error('Fatal error:', error);
        connectionStatus = 'error';
        setTimeout(connectToWhatsApp, 10000);
    }
}

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🌐 Server running on port ${PORT}`);
    connectToWhatsApp();
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('Shutting down...');
    if (sock) sock.end();
    process.exit(0);
});
