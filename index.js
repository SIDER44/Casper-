const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const qrcode = require('qrcode');
const express = require('express');
const fs = require('fs');
const path = require('path');
const { fileURLToPath } = require('url');

// Create express app
const app = express();
const PORT = process.env.PORT || 3000;

// Store connection status and QR
let connectionStatus = 'disconnected';
let latestQR = null;
let qrGenerated = false;
let retryCount = 0;
const MAX_RETRIES = 10;

// Session directory
const SESSION_DIR = path.join(__dirname, 'auth_info');

// Ensure session directory exists
if (!fs.existsSync(SESSION_DIR)) {
    fs.mkdirSync(SESSION_DIR, { recursive: true });
}

// Serve HTML page with QR code
app.get('/', (req, res) => {
    let qrHTML = '';
    
    if (latestQR && connectionStatus === 'awaiting_scan') {
        qrHTML = `
            <div class="qr-container">
                <h2>📱 Scan this QR Code with WhatsApp</h2>
                <img src="${latestQR}" alt="QR Code" style="width: 300px; height: 300px;"/>
                <div class="steps">
                    <p>1. Open WhatsApp on your phone</p>
                    <p>2. Tap Menu (3 dots) or Settings</p>
                    <p>3. Select "Linked Devices"</p>
                    <p>4. Tap "Link a Device"</p>
                    <p>5. Scan this QR code</p>
                </div>
            </div>
        `;
    } else if (connectionStatus === 'connected') {
        qrHTML = '<div class="success">✅ Bot is connected to WhatsApp!</div>';
    } else {
        qrHTML = '<div class="waiting">⏳ Waiting for QR code generation...</div>';
    }
    
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Casper WhatsApp Bot</title>
            <meta http-equiv="refresh" content="10">
            <style>
                body {
                    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    margin: 0;
                    padding: 20px;
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    min-height: 100vh;
                }
                .container {
                    background: white;
                    padding: 40px;
                    border-radius: 20px;
                    box-shadow: 0 20px 60px rgba(0,0,0,0.3);
                    text-align: center;
                    max-width: 600px;
                    width: 100%;
                }
                h1 {
                    color: #764ba2;
                    margin-bottom: 10px;
                    font-size: 2.5em;
                }
                .bot-avatar {
                    font-size: 80px;
                    margin: 20px 0;
                }
                .status-box {
                    padding: 15px;
                    border-radius: 10px;
                    margin: 20px 0;
                    font-weight: bold;
                }
                .connected {
                    background: #d4edda;
                    color: #155724;
                    border: 2px solid #c3e6cb;
                }
                .disconnected {
                    background: #f8d7da;
                    color: #721c24;
                    border: 2px solid #f5c6cb;
                }
                .awaiting {
                    background: #fff3cd;
                    color: #856404;
                    border: 2px solid #ffeeba;
                }
                .qr-container {
                    margin: 30px 0;
                    padding: 20px;
                    background: #f8f9fa;
                    border-radius: 15px;
                }
                .steps {
                    text-align: left;
                    background: white;
                    padding: 20px;
                    border-radius: 10px;
                    margin-top: 20px;
                }
                .steps p {
                    margin: 10px 0;
                    padding: 10px;
                    background: #e9ecef;
                    border-radius: 5px;
                }
                .features {
                    display: grid;
                    grid-template-columns: repeat(2, 1fr);
                    gap: 10px;
                    margin-top: 30px;
                }
                .feature {
                    background: #f8f9fa;
                    padding: 15px;
                    border-radius: 10px;
                    border-left: 4px solid #764ba2;
                }
                .retry {
                    color: #666;
                    font-size: 14px;
                    margin-top: 20px;
                }
                .refresh {
                    color: #764ba2;
                    text-decoration: none;
                    display: inline-block;
                    margin-top: 20px;
                }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="bot-avatar">🤖</div>
                <h1>Casper Bot</h1>
                <p>Your friendly WhatsApp assistant</p>
                
                <div class="status-box ${connectionStatus === 'connected' ? 'connected' : connectionStatus === 'awaiting_scan' ? 'awaiting' : 'disconnected'}">
                    Status: 
                    ${connectionStatus === 'connected' ? '✅ Connected to WhatsApp' : 
                      connectionStatus === 'awaiting_scan' ? '📱 Ready to scan - QR code below' : 
                      '⏳ Initializing...'}
                </div>
                
                ${qrHTML}
                
                <div class="features">
                    <div class="feature">!ping - Check bot status</div>
                    <div class="feature">!hello - Get greeting</div>
                    <div class="feature">!time - Current time</div>
                    <div class="feature">!help - Show commands</div>
                </div>
                
                <div class="retry">
                    Retry count: ${retryCount}/${MAX_RETRIES}
                </div>
                
                <a href="/" class="refresh">🔄 Refresh Page</a>
                
                <p style="margin-top: 30px; color: #666; font-size: 12px;">
                    Casper Bot v2.0 | Made for WhatsApp
                </p>
            </div>
        </body>
        </html>
    `);
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ 
        status: 'healthy', 
        bot: 'Casper',
        connection: connectionStatus,
        qr_available: !!latestQR,
        retry_count: retryCount,
        timestamp: new Date().toISOString() 
    });
});

// API endpoint to get QR as JSON
app.get('/api/qr', (req, res) => {
    res.json({
        qr: latestQR,
        status: connectionStatus,
        retry: retryCount
    });
});

// Main WhatsApp connection function
async function connectToWhatsApp() {
    console.log('\n' + '='.repeat(50));
    console.log('🤖 CASPER BOT - Starting...');
    console.log('='.repeat(50));
    
    try {
        // Load authentication state
        const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
        
        // Create socket connection
        const sock = makeWASocket({
            auth: state,
            printQRInTerminal: false, // We'll handle QR manually
            browser: ['Casper Bot', 'Chrome', '1.0.0'],
            syncFullHistory: false,
            markOnlineOnConnect: true
        });

        // Handle connection updates
        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;
            
            // Handle QR code
            if (qr) {
                try {
                    console.log('📱 Generating QR code...');
                    // Generate QR as data URL
                    latestQR = await qrcode.toDataURL(qr);
                    qrGenerated = true;
                    connectionStatus = 'awaiting_scan';
                    retryCount = 0;
                    console.log('✅ QR code generated! Visit the web page to scan.');
                    console.log(`🌐 Web URL: https://${process.env.RENDER_EXTERNAL_URL || 'localhost:'+PORT}`);
                } catch (err) {
                    console.error('❌ Error generating QR:', err);
                }
            }
            
            // Handle connection close
            if (connection === 'close') {
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
                
                console.log('❌ Connection closed:', lastDisconnect?.error?.message || 'Unknown error');
                console.log('Status code:', statusCode);
                
                connectionStatus = 'disconnected';
                
                if (shouldReconnect && retryCount < MAX_RETRIES) {
                    retryCount++;
                    const delay = Math.min(1000 * Math.pow(2, retryCount), 30000); // Exponential backoff
                    console.log(`🔄 Reconnecting in ${delay/1000} seconds... (Attempt ${retryCount}/${MAX_RETRIES})`);
                    setTimeout(connectToWhatsApp, delay);
                } else if (retryCount >= MAX_RETRIES) {
                    console.log('❌ Max retries reached. Please check your internet connection.');
                } else {
                    console.log('🔐 Logged out. Clearing session...');
                    // Clear session folder
                    fs.rmSync(SESSION_DIR, { recursive: true, force: true });
                    fs.mkdirSync(SESSION_DIR, { recursive: true });
                    retryCount = 0;
                    setTimeout(connectToWhatsApp, 5000);
                }
            }
            
            // Handle successful connection
            if (connection === 'open') {
                console.log('✅ CASPER BOT CONNECTED SUCCESSFULLY!');
                console.log(`👤 Bot info:`, sock.user);
                connectionStatus = 'connected';
                retryCount = 0;
                qrGenerated = false;
                latestQR = null;
            }
            
            // Handle connecting state
            if (connection === 'connecting') {
                console.log('🔄 Connecting to WhatsApp...');
                connectionStatus = 'connecting';
            }
        });

        // Save credentials on update
        sock.ev.on('creds.update', saveCreds);

        // Handle messages
        sock.ev.on('messages.upsert', async ({ messages }) => {
            const msg = messages[0];
            
            // Ignore own messages and status updates
            if (!msg.message || msg.key.fromMe) return;
            
            // Get message content
            let text = '';
            if (msg.message.conversation) {
                text = msg.message.conversation;
            } else if (msg.message.extendedTextMessage) {
                text = msg.message.extendedTextMessage.text;
            }
            
            if (!text) return;
            
            const sender = msg.key.remoteJid;
            const senderName = msg.pushName || 'Unknown';
            
            console.log(`📨 Message from ${senderName}: ${text}`);
            
            // Command handling
            const command = text.toLowerCase().trim();
            
            // Ping command
            if (command === '!ping' || command === 'ping') {
                await sock.sendMessage(sender, { 
                    text: '🏓 Pong! Casper is online and working!' 
                });
            }
            
            // Hello command
            else if (command === '!hello' || command === 'hello' || command === 'hi') {
                const greetings = [
                    `👋 Hello ${senderName}! I'm Casper, your WhatsApp assistant!`,
                    `Hey ${senderName}! 🤖 How can I help you today?`,
                    `Hi there ${senderName}! Casper at your service! ✨`
                ];
                await sock.sendMessage(sender, { 
                    text: greetings[Math.floor(Math.random() * greetings.length)] 
                });
            }
            
            // Time command
            else if (command === '!time' || command === 'time') {
                const now = new Date();
                const timeStr = now.toLocaleString('en-US', { 
                    weekday: 'long',
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                    timeZoneName: 'short'
                });
                await sock.sendMessage(sender, { 
                    text: `🕐 Current time: ${timeStr}` 
                });
            }
            
            // Help command
            else if (command === '!help' || command === 'help') {
                const helpText = `🤖 *CASPER BOT COMMANDS*\n\n` +
                               `━━━━━━━━━━━━━━━━\n\n` +
                               `• *!ping* - Check if bot is online\n` +
                               `• *!hello* - Get a friendly greeting\n` +
                               `• *!time* - Check current time\n` +
                               `• *!help* - Show this menu\n\n` +
                               `━━━━━━━━━━━━━━━━\n` +
                               `✨ Made with ❤️ by Casper`;
                
                await sock.sendMessage(sender, { text: helpText });
            }
            
            // Easter egg - thank you response
            else if (command.includes('thank')) {
                const responses = [
                    "You're welcome! 😊",
                    "Happy to help! 🤗",
                    "Anytime! 👍",
                    "My pleasure! 🎉"
                ];
                await sock.sendMessage(sender, { 
                    text: responses[Math.floor(Math.random() * responses.length)] 
                });
            }
        });

        return sock;
        
    } catch (error) {
        console.error('❌ Fatal error:', error);
        connectionStatus = 'error';
        
        if (retryCount < MAX_RETRIES) {
            retryCount++;
            console.log(`🔄 Retrying in 10 seconds... (${retryCount}/${MAX_RETRIES})`);
            setTimeout(connectToWhatsApp, 10000);
        }
    }
}

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log('\n' + '🌟'.repeat(20));
    console.log('🤖 CASPER BOT IS RUNNING');
    console.log('🌟'.repeat(20));
    console.log(`\n🌐 Web URL: https://${process.env.RENDER_EXTERNAL_URL || 'localhost:'+PORT}`);
    console.log(`📊 Health check: https://${process.env.RENDER_EXTERNAL_URL || 'localhost:'+PORT}/health`);
    console.log(`🔄 QR API: https://${process.env.RENDER_EXTERNAL_URL || 'localhost:'+PORT}/api/qr`);
    console.log('\n' + '='.repeat(50) + '\n');
    
    // Start WhatsApp connection after server is up
    setTimeout(connectToWhatsApp, 2000);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('👋 Received SIGTERM. Shutting down gracefully...');
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('👋 Received SIGINT. Shutting down gracefully...');
    process.exit(0);
});
