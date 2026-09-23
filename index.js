require('dotenv').config();
const http = require('http');
const url = require('url');
const fs = require('fs');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcodeTerminal = require('qrcode-terminal');
const QRCode = require('qrcode');

const AI_PROVIDER = (process.env.AI_PROVIDER || 'deepseek').toLowerCase();

// DeepSeek Settings
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || '';
const DEEPSEEK_BASE_URL = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com';
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat';

// Gemini Settings
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

// Hermes Settings (via OpenRouter)
const HERMES_API_KEY = process.env.HERMES_API_KEY || '';
const HERMES_BASE_URL = process.env.HERMES_BASE_URL || 'https://openrouter.ai/api/v1';
const HERMES_MODEL = process.env.HERMES_MODEL || 'nousresearch/hermes-3-llama-3.1-8b';

const OWNER_NAME = process.env.OWNER_NAME || 'My Owner';
const BOT_NAME = process.env.BOT_NAME || 'Hermes AI';
const SYSTEM_PROMPT = process.env.SYSTEM_PROMPT || 
    `You are ${BOT_NAME}, an intelligent personal assistant managing WhatsApp messages for ${OWNER_NAME} while they are away or busy. ` +
    `Be friendly, polite, concise, and helpful. If someone needs urgent contact with ${OWNER_NAME}, let them know their message has been recorded and ${OWNER_NAME} will get back to them as soon as possible. ` +
    `Answer general questions accurately. Keep WhatsApp replies brief and natural, avoiding overly lengthy walls of text unless explicitly requested.`;

const chatHistory = new Map();
const MAX_HISTORY = 10;

let currentQR = null;
let currentQRDataUrl = null;
let currentQRSVG = null;
let clientStatus = 'STARTING';

async function getDeepSeekReply(chatId, userMessage) {
    if (!DEEPSEEK_API_KEY) {
        return "I am online, but my DeepSeek API key is not configured.";
    }

    const history = chatHistory.get(chatId) || [];
    history.push({ role: 'user', content: userMessage });

    const messages = [
        { role: 'system', content: SYSTEM_PROMPT },
        ...history.slice(-MAX_HISTORY)
    ];

    try {
        const resp = await fetch(`${DEEPSEEK_BASE_URL}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${DEEPSEEK_API_KEY}`
            },
            body: JSON.stringify({
                model: DEEPSEEK_MODEL,
                messages: messages,
                max_tokens: 500,
                temperature: 0.7
            })
        });

        if (!resp.ok) {
            const errText = await resp.text();
            console.error(`[DeepSeek Error ${resp.status}]:`, errText);
            return "Sorry, I had a momentary issue processing that message.";
        }

        const data = await resp.json();
        const replyText = data.choices?.[0]?.message?.content?.trim() || "Message received!";
        
        history.push({ role: 'assistant', content: replyText });
        chatHistory.set(chatId, history.slice(-MAX_HISTORY));

        return replyText;
    } catch (err) {
        console.error('[DeepSeek Fetch Exception]:', err.message);
        return "Sorry, I couldn't reach DeepSeek at the moment.";
    }
}

async function getGeminiReply(chatId, userMessage) {
    if (!GEMINI_API_KEY) {
        return "I am currently online, but my Gemini API key has not been configured yet.";
    }

    const history = chatHistory.get(chatId) || [];
    history.push({ role: 'user', parts: [{ text: userMessage }] });

    const contents = [
        { role: 'user', parts: [{ text: `[System Instruction: ${SYSTEM_PROMPT}]` }] },
        { role: 'model', parts: [{ text: "Understood. I will act as the personal assistant adhering strictly to these instructions." }] },
        ...history.slice(-MAX_HISTORY)
    ];

    try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
        const resp = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: contents,
                generationConfig: {
                    temperature: 0.7,
                    maxOutputTokens: 500
                }
            })
        });

        if (!resp.ok) {
            const errText = await resp.text();
            console.error(`[Gemini Error ${resp.status}]:`, errText);
            return "Sorry, I had a momentary issue processing that message.";
        }

        const data = await resp.json();
        const candidate = data.candidates?.[0]?.content?.parts?.[0]?.text;
        const replyText = candidate ? candidate.trim() : "Thank you for your message. I'll pass it along!";
        
        history.push({ role: 'model', parts: [{ text: replyText }] });
        chatHistory.set(chatId, history.slice(-MAX_HISTORY));

        return replyText;
    } catch (err) {
        console.error('[Gemini Fetch Exception]:', err.message);
        return "Sorry, I couldn't reach my AI brain at the moment.";
    }
}

async function getHermesReply(chatId, userMessage) {
    if (!HERMES_API_KEY) {
        return "I am currently online, but my Hermes API key has not been configured yet.";
    }

    const history = chatHistory.get(chatId) || [];
    history.push({ role: 'user', content: userMessage });

    const messages = [
        { role: 'system', content: SYSTEM_PROMPT },
        ...history.slice(-MAX_HISTORY)
    ];

    try {
        const resp = await fetch(`${HERMES_BASE_URL}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${HERMES_API_KEY}`
            },
            body: JSON.stringify({
                model: HERMES_MODEL,
                messages: messages,
                max_tokens: 500,
                temperature: 0.7
            })
        });

        if (!resp.ok) {
            const errText = await resp.text();
            console.error(`[Hermes Error ${resp.status}]:`, errText);
            return "Sorry, I encountered an issue connecting to Hermes.";
        }

        const data = await resp.json();
        const replyText = data.choices?.[0]?.message?.content?.trim() || "Message received!";
        
        history.push({ role: 'assistant', content: replyText });
        chatHistory.set(chatId, history.slice(-MAX_HISTORY));

        return replyText;
    } catch (err) {
        console.error('[Hermes Fetch Exception]:', err.message);
        return "Sorry, I couldn't reach the Hermes model.";
    }
}

async function generateAIReply(chatId, userMessage) {
    if (AI_PROVIDER === 'deepseek') {
        return await getDeepSeekReply(chatId, userMessage);
    } else if (AI_PROVIDER === 'gemini') {
        return await getGeminiReply(chatId, userMessage);
    } else {
        return await getHermesReply(chatId, userMessage);
    }
}

console.log('--------------------------------------------------');
console.log(`Starting ${BOT_NAME} on WhatsApp Web (Multi-Device)...`);
console.log(`Active Brain: ${AI_PROVIDER.toUpperCase()} (${AI_PROVIDER === 'deepseek' ? DEEPSEEK_MODEL : (AI_PROVIDER === 'gemini' ? GEMINI_MODEL : HERMES_MODEL)})`);
console.log('--------------------------------------------------');

const client = new Client({
    authStrategy: new LocalAuth({ dataPath: './.wwebjs_auth' }),
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    puppeteer: {
        headless: true,
        protocolTimeout: 180000,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu'
        ]
    }
});

client.options.puppeteer.executablePath = undefined;

client.on('qr', async (qr) => {
    clientStatus = 'QR_READY';
    currentQR = qr;
    console.log('\n================== SCAN THIS QR CODE ==================');
    console.log('Open WhatsApp on your phone -> Settings -> Linked Devices -> Link a Device:\n');
    qrcodeTerminal.generate(qr, { small: true });
    console.log('RAW_QR:' + qr);
    console.log('========================================================\n');
    try {
        currentQRDataUrl = await QRCode.toDataURL(qr, { margin: 2, scale: 8 });
        currentQRSVG = await QRCode.toString(qr, { type: 'svg', margin: 2 });
        fs.writeFileSync('/home/sgarm/whatsapp-agent/current_qr.txt', qr);
        fs.writeFileSync('/home/sgarm/whatsapp-agent/current_qr.svg', currentQRSVG);
    } catch (err) {
        console.error('Error generating QR image:', err);
    }
});

client.on('ready', () => {
    clientStatus = 'CONNECTED';
    console.log(`\n[SUCCESS] ${BOT_NAME} is connected and actively listening for WhatsApp messages 24/7!`);
});

client.on('authenticated', () => {
    clientStatus = 'AUTHENTICATED';
    console.log('[AUTH] WhatsApp session authenticated successfully.');
});

client.on('auth_failure', (msg) => {
    clientStatus = 'AUTH_FAILURE';
    console.error('[AUTH ERROR] Authentication failure:', msg);
});

client.on('disconnected', (reason) => {
    clientStatus = 'DISCONNECTED';
    console.warn('[DISCONNECTED] Client was disconnected:', reason);
});

client.on('message', async (msg) => {
    if (msg.from === 'status@broadcast') return;
    if (msg.from.endsWith('@g.us')) return;
    if (msg.fromMe || !msg.body || msg.body.trim().length === 0) return;

    const sender = msg.from;
    const incomingText = msg.body.trim();

    // ─── STRICT WHITELIST: Only reply to 9358706440 (Himanshi) & 8529911832 (Roshan) ───
    const allowedLIDs = ['235429169213635@lid', '254975783530728@lid'];
    const allowedNumbers = ['9358706440', '8529911832', '919358706440', '918529911832'];

    let isAllowed = allowedLIDs.includes(sender) || allowedNumbers.some(num => sender.includes(num));
    if (!isAllowed) {
        try {
            const contact = await msg.getContact();
            const contactNum = (contact.number || '').replace(/[^\d]/g, '');
            if (allowedNumbers.some(num => contactNum.includes(num))) {
                isAllowed = true;
            }
        } catch(e) {}
    }

    if (!isAllowed) {
        console.log(`[FILTERED / IGNORED]: Message from ${sender} - Not in allowed whitelist.`);
        return;
    }

    console.log(`\n[INCOMING from Whitelisted ${sender}]: ${incomingText}`);

    try {
        const reply = await generateAIReply(sender, incomingText);
        console.log(`[REPLY to ${sender}]: ${reply}`);
        await msg.reply(reply);
    } catch (err) {
        console.error('[REPLY ERROR]:', err);
    }
});

const server = http.createServer(async (req, res) => {
    const parsedUrl = url.parse(req.url, true);
    const pathname = parsedUrl.pathname;

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        return res.end();
    }

    if (pathname === '/pair-code') {
        const phone = (parsedUrl.query.phone || '918058363027').replace(/[^\d]/g, '');
        try {
            console.log(`[PAIRING CODE] Requesting code for phone: ${phone}...`);
            const pairCode = await client.requestPairingCode(phone);
            console.log(`[PAIRING CODE] SUCCESS! Generated Code: ${pairCode}`);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: true, code: pairCode, phone: phone }));
        } catch (err) {
            console.error('[PAIRING CODE ERROR]:', err.message);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: false, error: err.message }));
        }
    }

    if (pathname === '/status') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ status: clientStatus, qr: currentQR, qrImg: currentQRDataUrl }));
    }

    if (pathname === '/qr.svg' && currentQRSVG) {
        res.writeHead(200, { 'Content-Type': 'image/svg+xml' });
        return res.end(currentQRSVG);
    }

    if (pathname === '/api/messages') {
        try {
            if (clientStatus !== 'CONNECTED' && clientStatus !== 'AUTHENTICATED') {
                res.writeHead(503, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ error: 'WhatsApp client not connected yet', status: clientStatus }));
            }

            const queryPhone = (parsedUrl.query.phone || parsedUrl.query.q || '').replace(/[^\d]/g, '');
            const days = parseInt(parsedUrl.query.days || '5', 10);
            console.log(`[API /messages] Extracting for phone='${queryPhone}', days=${days}`);

            const result = await client.pupPage.evaluate(async (phone, days) => {
                try {
                    const collections = window.require('WAWebCollections');
                    const ChatCollection = collections.Chat;
                    const ContactCollection = collections.Contact;
                    const WidFactory = window.require('WAWebWidFactory');

                    const allChats = ChatCollection.getModelsArray ? ChatCollection.getModelsArray() : [];
                    const allContacts = ContactCollection?.getModelsArray ? ContactCollection.getModelsArray() : [];

                    let matchedContact = null;
                    let targetChat = null;

                    if (phone && allContacts.length > 0) {
                        matchedContact = allContacts.find(c => {
                            const num = c.number || (c.id && (c.id.user || c.id._serialized)) || '';
                            const phoneStr = c.phoneNumber || '';
                            const name = c.name || c.__x_name || c.pushname || '';
                            return String(num).includes(phone) || String(phoneStr).includes(phone) || String(name).includes(phone);
                        });
                    }

                    if (phone) {
                        targetChat = allChats.find(c => {
                            const idStr = (c.id && (c.id._serialized || c.id.user)) || '';
                            const nameStr = c.name || c.__x_name || c.formattedTitle || '';
                            const contactName = c.contact?.name || c.contact?.pushname || c.contact?.number || '';
                            return String(idStr).includes(phone) || String(nameStr).includes(phone) || String(contactName).includes(phone);
                        });
                    }

                    if (!targetChat && matchedContact) {
                        const contactId = matchedContact.id;
                        const lid = matchedContact.lid;
                        targetChat = allChats.find(c => {
                            const cId = c.id?._serialized;
                            return cId === contactId?._serialized || (lid && cId === lid?._serialized);
                        });
                    }

                    if (!targetChat && phone) {
                        try {
                            const wid = WidFactory.createWid(`${phone}@c.us`);
                            targetChat = ChatCollection.get(wid);
                            if (!targetChat) {
                                const findAction = window.require('WAWebFindChatAction');
                                if (findAction?.findOrCreateLatestChat) {
                                    const res = await findAction.findOrCreateLatestChat(wid);
                                    targetChat = res?.chat || res;
                                }
                            }
                        } catch(e) {}
                    }

                    const shortPhone = phone.length > 10 ? phone.slice(-10) : phone;
                    if (!targetChat && shortPhone !== phone) {
                        targetChat = allChats.find(c => {
                            const idStr = (c.id && (c.id._serialized || c.id.user)) || '';
                            const nameStr = c.name || c.__x_name || c.formattedTitle || '';
                            return String(idStr).includes(shortPhone) || String(nameStr).includes(shortPhone);
                        });
                    }

                    if (!targetChat) {
                        return {
                            found: false,
                            searched: phone,
                            shortPhone: shortPhone,
                            matchedContact: matchedContact ? {
                                id: matchedContact.id?._serialized,
                                name: matchedContact.name || matchedContact.pushname,
                                number: matchedContact.number,
                                lid: matchedContact.lid?._serialized
                            } : null,
                            totalChats: allChats.length,
                            totalContacts: allContacts.length,
                            sampleChats: allChats.slice(0, 30).map(c => ({
                                id: c.id?._serialized,
                                name: c.name || c.__x_name || c.formattedTitle || '(No Name)',
                                contactName: c.contact?.name || c.contact?.pushname || null
                            }))
                        };
                    }

                    try {
                        if (targetChat.loadEarlierMsgs) {
                            await targetChat.loadEarlierMsgs();
                        }
                    } catch(e) {}

                    const msgs = targetChat.msgs?.getModelsArray ? targetChat.msgs.getModelsArray() : (targetChat.msgs?.models || []);
                    const sinceTimestamp = Math.floor((Date.now() - (days * 24 * 60 * 60 * 1000)) / 1000);

                    const filtered = msgs.filter(m => {
                        const t = m.t || m.timestamp;
                        return t >= sinceTimestamp;
                    });

                    const targetMsgs = filtered.length > 0 ? filtered : msgs;

                    const formatted = targetMsgs.map(m => {
                        const t = m.t || m.timestamp || 0;
                        return {
                            id: (m.id && (m.id._serialized || m.id.id)) || '',
                            timestamp: t,
                            datetime: t ? new Date(t * 1000).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : null,
                            from: (m.from && (m.from._serialized || m.from)) || '',
                            to: (m.to && (m.to._serialized || m.to)) || '',
                            fromMe: Boolean(m.id && m.id.fromMe !== undefined ? m.id.fromMe : m.fromMe),
                            type: m.type || 'chat',
                            body: m.body || m.caption || (m.type && m.type !== 'chat' ? `[${m.type}]` : '')
                        };
                    });

                    return {
                        found: true,
                        chat: {
                            id: targetChat.id?._serialized || '',
                            name: targetChat.name || targetChat.__x_name || targetChat.formattedTitle || 'Unknown',
                            isGroup: targetChat.isGroup || false
                        },
                        sinceTime: new Date(sinceTimestamp * 1000).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
                        totalInChat: msgs.length,
                        matchedInLastDays: filtered.length,
                        messages: formatted
                    };
                } catch(err) {
                    return { error: err.message, stack: err.stack };
                }
            }, queryPhone, days);

            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify(result, null, 2));
        } catch(err) {
            console.error('Server error in /api/messages:', err);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: err.message }));
        }
    }

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>Link WhatsApp - Hermes AI</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
        * { box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: #eef2f5; color: #111b21; }
        .card { background: white; padding: 32px; border-radius: 16px; box-shadow: 0 8px 30px rgba(0,0,0,0.08); text-align: center; max-width: 440px; width: 92%; }
        h1 { font-size: 24px; margin: 0 0 6px 0; color: #008069; }
        p.subtitle { color: #54656f; font-size: 14px; margin: 0 0 20px 0; }
        .badge { display: inline-block; padding: 6px 14px; border-radius: 20px; font-weight: 600; font-size: 13px; margin-bottom: 18px; }
        .badge.waiting { background: #fff3cd; color: #856404; }
        .badge.connected { background: #d1e7dd; color: #0f5132; font-size: 16px; padding: 10px 18px; }
        .qr-wrap { display: flex; justify-content: center; align-items: center; min-height: 290px; margin-bottom: 20px; }
        .qr-wrap img { width: 280px; height: 280px; border: 2px solid #e2e8f0; border-radius: 12px; }
        .instructions { text-align: left; background: #f8fafc; border: 1px solid #e2e8f0; padding: 14px 18px; border-radius: 10px; font-size: 13px; line-height: 1.6; color: #334155; }
        .instructions ol { margin: 0; padding-left: 20px; }
        .spinner { border: 4px solid #f3f3f3; border-top: 4px solid #008069; border-radius: 50%; width: 36px; height: 36px; animation: spin 1s linear infinite; margin: 20px auto; }
        @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
    </style>
</head>
<body>
    <div class="card">
        <h1>Link WhatsApp</h1>
        <p class="subtitle">${BOT_NAME} - 24/7 AI Assistant (DeepSeek V3)</p>
        <div id="badge" class="badge waiting">⏳ Fetching QR Code...</div>
        <div class="qr-wrap" id="qr-container">
            <div id="loading"><div class="spinner"></div>Loading latest QR Code...</div>
        </div>
        <div style="margin-top: 18px; padding: 14px; background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 12px; text-align: center;">
            <h3 style="margin: 0 0 6px 0; color: #166534; font-size: 15px;">📲 Link With Phone Number Instead</h3>
            <p style="font-size: 12px; color: #15803d; margin: 0 0 10px 0;">Don't want to scan QR? Send an 8-character OTP code directly to your phone:</p>
            <div style="display: flex; gap: 8px; justify-content: center; align-items: center;">
                <input id="phoneNumberInput" type="text" value="+918058363027" style="padding: 8px 12px; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 14px; width: 160px; font-weight: bold; text-align: center;" />
                <button id="sendOtpBtn" onclick="requestPairingCode()" style="background: #008069; color: white; border: none; padding: 8px 16px; border-radius: 8px; font-weight: 600; cursor: pointer; font-size: 14px;">Send Code</button>
            </div>
            <div id="pairingCodeResult" style="margin-top: 12px; display: none;"></div>
        </div>

        <div class="instructions" id="instructions">
            <ol>
                <li>Open <b>WhatsApp</b> on your mobile phone</li>
                <li>Go to <b>Settings</b> &rarr; <b>Linked Devices</b></li>
                <li>Tap <b>Link a Device</b></li>
                <li>Point your camera at this QR code to scan</li>
            </ol>
        </div>
    </div>
    <script>
        async function requestPairingCode() {
            const btn = document.getElementById('sendOtpBtn');
            const input = document.getElementById('phoneNumberInput');
            const resultDiv = document.getElementById('pairingCodeResult');
            const phone = input.value.replace(/[^\d]/g, '');
            if (!phone) return alert('Please enter your phone number');
            btn.disabled = true;
            btn.innerText = 'Requesting...';
            resultDiv.style.display = 'block';
            resultDiv.innerHTML = '<div style="color: #64748b; font-size: 13px;">Connecting to WhatsApp and requesting code...</div>';
            try {
                const res = await fetch('/pair-code?phone=' + phone);
                const data = await res.json();
                if (data.success && data.code) {
                    resultDiv.innerHTML = '<div style="padding: 12px; background: white; border: 2px dashed #008069; border-radius: 8px;"><div style="font-size: 12px; color: #54656f; margin-bottom: 4px;">ENTER THIS CODE IN WHATSAPP:</div><div style="font-size: 28px; font-weight: 800; letter-spacing: 4px; color: #008069;">' + data.code + '</div><div style="font-size: 12px; color: #15803d; margin-top: 6px;">Check the notification on phone or enter in Linked Devices!</div></div>';
                } else {
                    resultDiv.innerHTML = '<div style="color: #dc2626; font-size: 13px;">Error: ' + (data.error || 'Failed to request code') + '</div>';
                }
            } catch(e) {
                resultDiv.innerHTML = '<div style="color: #dc2626; font-size: 13px;">Error connecting to agent server</div>';
            } finally {
                btn.disabled = false;
                btn.innerText = 'Send Code';
            }
        }

        let lastQR = '';
        async function checkStatus() {
            try {
                const res = await fetch('/status');
                const data = await res.json();
                const badge = document.getElementById('badge');
                const container = document.getElementById('qr-container');
                const instructions = document.getElementById('instructions');

                if (data.status === 'CONNECTED' || data.status === 'AUTHENTICATED') {
                    badge.className = 'badge connected';
                    badge.innerHTML = '✅ WhatsApp Connected Successfully!';
                    container.innerHTML = '<div style="padding:20px;color:#0f5132;font-weight:600;font-size:16px;">WhatsApp is linked! DeepSeek AI assistant is active 24/7.</div>';
                    instructions.style.display = 'none';
                    return;
                }
                if (data.qrImg) {
                    badge.className = 'badge waiting';
                    badge.innerHTML = '📲 Ready to Scan (Live)';
                    if (lastQR !== data.qr) {
                        lastQR = data.qr;
                        container.innerHTML = '<img src="' + data.qrImg + '" alt="WhatsApp QR Code" />';
                    }
                }
            } catch(e) {}
        }
        setInterval(checkStatus, 1500);
        checkStatus();
    </script>
</body>
</html>`);
});

server.listen(3000, '0.0.0.0', () => {
    console.log('[HTTP] QR & API Server running on http://0.0.0.0:3000');
});

client.initialize();
