const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const express = require('express');
const fs = require('fs');
const path = require('path');

// Create express app for hosting
const app = express();
const PORT = process.env.PORT || 3000;

// Store session info
const SESSION_DIR = './auth_info';

// Ensure session directory exists
if (!fs.existsSync(SESSION_DIR)) {
    fs.mkdirSync(SESSION_DIR, { recursive: true });
}

// Store connection status
let connectionStatus = 'disconnected';
let botName = 'Casper';

// Serve a simple webpage
app.get('/', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Casper WhatsApp Bot</title>
            <style>
                body {
                    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    margin: 0;
                    padding: 0;
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
                    max-width: 500px;
                }
                h1 {
                    color: #764ba2;
                    margin-bottom: 10px;
                }
                .status {
                    padding: 15px;
                    border-radius: 10px;
                    margin: 20px 0;
                    font-weight: bold;
                }
                .connected {
                    background: #d4edda;
                    color: #155724;
                    border: 1px solid #c3e6cb;
                }
                .disconnected {
                    background: #f8d7da;
                    color: #721c24;
                    border: 1px solid #f5c6cb;
                }
                .features {
                    text-align: left;
                    background: #f8f9fa;
                    padding: 20px;
                    border-radius: 10px;
                    margin-top: 20px;
                }
                .feature-item {
                    margin: 10px 0;
                    padding: 5px;
                    border-left: 3px solid #764ba2;
                }
                .emoji {
                    font-size: 60px;
                    margin: 20px 0;
                }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="emoji">🤖</div>
                <h1>Casper WhatsApp Bot</h1>
                <p>Your friendly WhatsApp assistant</p>
                
                <div class="status ${connectionStatus === 'connected' ? 'connected' : 'disconnected'}">
                    Status: ${connectionStatus === 'connected' ? '✅ Connected to WhatsApp' : '⏳ Waiting for connection...'}
                </div>
                
                <div class="features">
                    <h3>✨ Features:</h3>
                    <div class="feature-item">• !ping - Check if bot is online</div>
                    <div class="feature-item">• !hello - Get a friendly greeting</div>
                    <div class="feature-item">• !time - Check current time</div>
                    <div class="feature-item">• !help - Show all commands</div>
                </div>
                
                <p style="margin-top: 20px; color: #666; font-size: 12px;">
                    Version 1.0.0 | Made with ❤️ for WhatsApp
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
        timestamp: new Date().toISOString() 
    });
});

// WhatsApp connection function
async function connectToWhatsApp() {
    console.log('🤖 Casper Bot - Starting WhatsApp connection...');
    console.log('📱 Please wait for QR code...');
    
    try {
        // Load saved authentication state
        const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
        
        // Create WhatsApp socket connection
        const sock = makeWASocket({
            auth: state,
            printQRInTerminal: true, // Show QR in console
            browser: ['Casper Bot', 'Chrome', '1.0.0']
        });

        // Handle connection updates
        sock.ev.on('connection.update', (update) => {
            const { connection, lastDisconnect, qr } = update;
            
            if (qr) {
                console.log('\n🔵 Scan this QR code with your WhatsApp:');
                qrcode.generate(qr, { small: true });
                console.log('\n📱 Steps to connect:');
                console.log('1. Open WhatsApp on your phone');
                console.log('2. Tap Menu (3 dots) or Settings');
                console.log('3. Select "Linked Devices"');
                console.log('4. Tap "Link a Device"');
                console.log('5. Scan this QR code\n');
                connectionStatus = 'awaiting_scan';
            }
            
            if (connection === 'close') {
                const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
                console.log('❌ Connection closed:', lastDisconnect?.error?.message || 'Unknown error');
                
                if (shouldReconnect) {
                    console.log('🔄 Reconnecting in 5 seconds...');
                    setTimeout(connectToWhatsApp, 5000);
                } else {
                    console.log('🔐 Logged out. Please delete auth_info folder and restart.');
                    connectionStatus = 'logged_out';
                }
            } else if (connection === 'open') {
                console.log('✅ Casper Bot is connected to WhatsApp!');
                console.log(`👤 Bot name: ${sock.user?.name || 'Casper'}`);
                console.log(`📱 Phone number: ${sock.user?.id || 'Unknown'}`);
                connectionStatus = 'connected';
                
                // Send startup message to yourself (optional)
                // You can enable this by adding your number
            }
        });

        // Save credentials on update
        sock.ev.on('creds.update', saveCreds);

        // Handle incoming messages
        sock.ev.on('messages.upsert', async ({ messages, type }) => {
            const msg = messages[0];
            
            // Ignore status updates and own messages
            if (!msg.message || msg.key.fromMe) return;
            
            // Get message text
            let text = '';
            if (msg.message.conversation) {
                text = msg.message.conversation;
            } else if (msg.message.extendedTextMessage) {
                text = msg.message.extendedTextMessage.text;
            }
            
            const sender = msg.key.remoteJid;
            const isGroup = sender.endsWith('@g.us');
            const senderName = msg.pushName || 'Unknown';
            
            // Log message (without showing full number for privacy)
            console.log(`📨 Message from ${senderName}: ${text}`);
            
            // Skip commands in groups unless you want to enable them
            // if (isGroup) return; // Uncomment to ignore group messages
            
            // Basic commands
            if (text.toLowerCase() === '!ping' || text.toLowerCase() === 'ping') {
                await sock.sendMessage(sender, { text: '🏓 Pong! Casper is online!' });
                console.log('✅ Responded to ping');
            }
            
            if (text.toLowerCase() === '!hello' || text.toLowerCase() === 'hello' || text.toLowerCase() === 'hi') {
                const greetings = [
                    `👋 Hello ${senderName}! I'm Casper, your WhatsApp assistant!`,
                    `Hey ${senderName}! 👋 How can I help you today?`,
                    `Hi there ${senderName}! 🤖 Casper at your service!`
                ];
                const randomGreeting = greetings[Math.floor(Math.random() * greetings.length)];
                await sock.sendMessage(sender, { text: randomGreeting });
            }
            
            if (text.toLowerCase() === '!time' || text.toLowerCase() === 'time') {
                const now = new Date();
                const timeStr = now.toLocaleString('en-US', { 
                    weekday: 'long', 
                    year: 'numeric', 
                    month: 'long', 
                    day: 'numeric',
                    hour: '2-digit', 
                    minute: '2-digit',
                    second: '2-digit'
                });
                await sock.sendMessage(sender, { text: `🕐 Current time: ${timeStr}` });
            }
            
            if (text.toLowerCase() === '!help' || text.toLowerCase() === 'help') {
                const helpText = `🤖 *Casper Bot Commands*\n\n` +
                                `━━━━━━━━━━━━━━━━\n\n` +
                                `• *!ping* - Check if bot is online\n` +
                                `• *!hello* - Get a friendly greeting\n` +
                                `• *!time* - Check current time\n` +
                                `• *!help* - Show this menu\n\n` +
                                `━━━━━━━━━━━━━━━━\n` +
                                `✨ More features coming soon!\n` +
                                `💡 Made with ❤️`;
                
                await sock.sendMessage(sender, { text: helpText });
            }
            
            // Easter egg - respond to "thank you"
            if (text.toLowerCase().includes('thank') || text.toLowerCase().includes('thanks')) {
                const responses = [
                    "You're welcome! 😊",
                    "Happy to help! 🤗",
                    "Anytime! 👍",
                    "My pleasure! 🎉"
                ];
                const randomResponse = responses[Math.floor(Math.random() * responses.length)];
                await sock.sendMessage(sender, { text: randomResponse });
            }
        });

        return sock;
        
    } catch (error) {
        console.error('❌ Error connecting to WhatsApp:', error);
        connectionStatus = 'error';
    }
}

// Start the server
app.listen(PORT, () => {
    console.log('\n' + '='.repeat(50));
    console.log('🤖 CASPER BOT STARTING UP');
    console.log('='.repeat(50));
    console.log(`🌐 Web server running on port ${PORT}`);
    console.log(`📊 Health check: http://localhost:${PORT}/health`);
    console.log('='.repeat(50) + '\n');
    
    // Start WhatsApp connection
    connectToWhatsApp().catch(err => {
        console.error('❌ Failed to connect:', err);
    });
});

// Handle graceful shutdown
process.on('SIGINT', () => {
    console.log('\n👋 Shutting down Casper Bot...');
    process.exit(0);
});
