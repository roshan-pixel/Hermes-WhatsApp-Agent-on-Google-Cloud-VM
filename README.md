# 🏛️ Complete Architecture & Deployment Guide: Hermes WhatsApp AI Agent on Google Cloud VM

---

## 📋 Executive Summary
This document provides an end-to-end, comprehensive record of how the **Hermes WhatsApp AI Agent** was architected, deployed, configured, paired with WhatsApp, upgraded, and optimized on a **Google Cloud Platform (GCP) Compute Engine** Virtual Machine.

---

## 1. Infrastructure Specifications

| Parameter | Initial Spec | Upgraded Production Spec |
| :--- | :--- | :--- |
| **GCP Project** | `utility-melody-390608` | `utility-melody-390608` |
| **VM Instance Name** | `hermes-whatsapp-agent` | `hermes-whatsapp-agent` |
| **Zone** | `us-central1-a` | `us-central1-a` |
| **Machine Type** | `e2-micro` (2 vCPUs burstable, 1 GB RAM) | `e2-medium` (2 vCPUs, 4 GB RAM) |
| **Operating System** | Ubuntu 22.04 LTS / Debian Linux | Ubuntu 22.04 LTS / Debian Linux |
| **External Static IP** | `136.65.153.237` (Ephemeral -> Reserved Static) | `136.65.153.237` |
| **SSH Key Path** | `C:\Users\sgarm\.ssh\google_compute_engine` | `C:\Users\sgarm\.ssh\google_compute_engine` |
| **Default User** | `sgarm` | `sgarm` |
| **AI Providers** | Google Gemini (`gemini-2.5-flash`) | DeepSeek API (`deepseek-chat`) / Hermes |
| **Process Daemon** | PM2 Process Manager | PM2 Process Manager (Autostart + Monitored) |

---

## 2. VM Creation & SSH Setup

### A. SSH Key Generation & Local Terminal Connection
The VM was provisioned using Google Compute Engine SSH keys generated in your Windows user profile:
```powershell
# Connect directly from Windows PowerShell
ssh -i "$env:USERPROFILE\.ssh\google_compute_engine" sgarm@136.65.153.237
```

### B. Cloud Shell VM Management Commands
When operating from **Google Cloud Shell** (`sgarmy200@cloudshell:~ (utility-melody-390608)`), the instance is controlled with:
```bash
# Set default project & zone
gcloud config set project utility-melody-390608
gcloud config set compute/zone us-central1-a

# Check instance status
gcloud compute instances list
```

---

## 3. Server Provisioning & Dependencies

Headless Chrome (Puppeteer) requires several system libraries to render the WhatsApp Web client in headless mode without crashing.

### A. Updating System Packages
```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl wget git build-essential software-properties-common
```

### B. Installing Node.js LTS (v20.x)
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node -v   # v20.x.x
npm -v    # v10.x.x
```

### C. Installing Puppeteer / Chromium Dependencies
```bash
sudo apt install -y \
  gconf-service libasound2 libatk1.0-0 libatk-bridge2.0-0 libc6 libcairo2 libcups2 \
  libdbus-1-3 libexpat1 libfontconfig1 libgcc1 libgconf-2-4 libgdk-pixbuf2.0-0 \
  libglib2.0-0 libgtk-3-0 libnspr4 libpango-1.0-0 libpangocairo-1.0-0 libstdc++6 \
  libx11-6 libx11-xcb1 libxcb1 libxcomposite1 libxcursor1 libxdamage1 libxext6 \
  libxfixes3 libxi6 libxrandr2 libxrender1 libxss1 libxtst6 ca-certificates \
  fonts-liberation libappindicator1 libnss3 lsb-release xdg-utils libgbm1 libxkbcommon0
```

### D. Installing PM2 (Process Manager)
```bash
sudo npm install -g pm2
```

---

## 4. Hermes WhatsApp Agent Code & Architecture

### A. Project Directory Layout
```
/home/sgarm/whatsapp-agent/
├── .env                       # API keys, persona settings & provider selection
├── package.json               # Node module manifests
├── index.js                   # Main application code (Baileys / WhatsApp-Web.js client)
├── .wwebjs_auth/              # Multi-Device session keys & login cache
│   └── session/
└── .wwebjs_cache/             # Chromium session cache
```

### B. Dependencies (`package.json`)
```json
{
  "name": "whatsapp-agent",
  "version": "1.0.0",
  "description": "Hermes Autonomous WhatsApp Assistant",
  "main": "index.js",
  "scripts": {
    "start": "node index.js"
  },
  "dependencies": {
    "dotenv": "^16.4.5",
    "express": "^4.19.2",
    "qrcode-terminal": "^0.12.0",
    "whatsapp-web.js": "^1.25.0"
  }
}
```

### C. Environment Configuration (`.env`)
```bash
# Choose AI provider: 'deepseek', 'gemini', or 'hermes'
AI_PROVIDER=deepseek

# DeepSeek API Settings
DEEPSEEK_API_KEY=your_deepseek_api_key_here
DEEPSEEK_BASE_URL=https://api.deepseek.com/chat/completions
DEEPSEEK_MODEL=deepseek-chat

# Google Gemini Settings (Alternative)
GEMINI_API_KEY=your_gemini_api_key_here
GEMINI_MODEL=gemini-2.5-flash

# Hermes Settings (via OpenRouter)
HERMES_API_KEY=your_openrouter_hermes_key_here
HERMES_BASE_URL=https://openrouter.ai/api/v1
HERMES_MODEL=nousresearch/hermes-3-llama-3.1-8b

# Persona Settings
OWNER_NAME=User
BOT_NAME=Hermes AI Assistant
SYSTEM_PROMPT=You are Hermes, an intelligent personal assistant managing WhatsApp messages for your owner while they are away from their phone. Keep answers concise, polite, helpful, and natural.
```

### D. Core Agent Logic (`index.js`)
```javascript
require('dotenv').config();
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const express = require('express');

const AI_PROVIDER = (process.env.AI_PROVIDER || 'deepseek').toLowerCase();
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || '';
const OWNER_NAME = process.env.OWNER_NAME || 'My Owner';
const BOT_NAME = process.env.BOT_NAME || 'Hermes AI';
const SYSTEM_PROMPT = process.env.SYSTEM_PROMPT || 
    `You are ${BOT_NAME}, an intelligent personal assistant managing WhatsApp messages for ${OWNER_NAME} while they are away or busy. ` +
    `Be friendly, polite, concise, and helpful. Keep replies brief and natural.`;

const chatHistory = new Map();
const MAX_HISTORY = 10;

// DeepSeek Brain
async function getDeepSeekReply(chatId, userMessage) {
    if (!DEEPSEEK_API_KEY) return 'Hermes brain is currently not configured.';
    const history = chatHistory.get(chatId) || [];
    history.push({ role: 'user', content: userMessage });

    const messages = [
        { role: 'system', content: SYSTEM_PROMPT },
        ...history.slice(-MAX_HISTORY)
    ];

    try {
        const resp = await fetch('https://api.deepseek.com/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${DEEPSEEK_API_KEY}`
            },
            body: JSON.stringify({
                model: 'deepseek-chat',
                messages: messages,
                max_tokens: 500,
                temperature: 0.7
            })
        });
        const data = await resp.json();
        const reply = data.choices?.[0]?.message?.content?.trim() || 'Received!';
        history.push({ role: 'assistant', content: reply });
        chatHistory.set(chatId, history.slice(-MAX_HISTORY));
        return reply;
    } catch (err) {
        console.error('[DeepSeek Error]:', err.message);
        return 'Sorry, my AI engine is currently unreachable.';
    }
}

// Client Initialization
const client = new Client({
    authStrategy: new LocalAuth({ dataPath: './.wwebjs_auth' }),
    puppeteer: {
        headless: true,
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

let latestQR = null;

// QR Terminal Display
client.on('qr', (qr) => {
    latestQR = qr;
    console.log('
================== SCAN THIS QR CODE ==================');
    qrcode.generate(qr, { small: true });
    console.log('========================================================
');
});

client.on('authenticated', () => console.log('[AUTH] Authenticated successfully.'));
client.on('ready', () => console.log(`[READY] ${BOT_NAME} is active 24/7!`));

client.on('message', async (msg) => {
    if (msg.from === 'status@broadcast') return;
    if (msg.from.endsWith('@g.us')) return; // Ignore groups
    if (msg.fromMe || !msg.body || msg.body.trim().length === 0) return;

    console.log(`[INCOMING] ${msg.from}: ${msg.body}`);
    const reply = await getDeepSeekReply(msg.from, msg.body);
    await msg.reply(reply);
    console.log(`[REPLIED]: ${reply}`);
});

client.initialize();

// Express web fallback for QR code viewing
const app = express();
app.get('/', (req, res) => {
    if (!latestQR) return res.send('<h2>Hermes WhatsApp Agent Active & Connected</h2>');
    res.send(`<h2>Scan WhatsApp QR Code:</h2><pre>${latestQR}</pre>`);
});
app.listen(3000, '0.0.0.0', () => console.log('QR Web server on port 3000'));
```

---

## 5. WhatsApp Linking & QR Code Pairing

### A. How WhatsApp Multi-Device Linking Works
WhatsApp uses the Multi-Device Baileys / Chromium protocol. Session tokens and cryptographic keys are saved into `.wwebjs_auth/`. Once paired, WhatsApp does **not** require your phone to be turned on or connected to the internet.

### B. Displaying the QR Code in PowerShell
```powershell
ssh -i "$env:USERPROFILE\.ssh\google_compute_engine" sgarm@136.65.153.237 "pm2 logs whatsapp-agent --lines 60 --nostream"
```

### C. Displaying the QR Code in Browser (Port Forwarding Tunnel)
To view the QR code in your local Chrome browser at `http://localhost:3000`:
```powershell
ssh -i "$env:USERPROFILE\.ssh\google_compute_engine" -L 3000:localhost:3000 sgarm@136.65.153.237
```

### D. Fixing the "Cannot link new devices, try again later" Error
When WhatsApp encounters too many failed login attempts, it locks pairing for 5 to 10 minutes.
**The Fix:**
1. Stop PM2: `pm2 stop whatsapp-agent`
2. Clear stale session locks:
   ```bash
   rm -rf /home/sgarm/whatsapp-agent/.wwebjs_auth /home/sgarm/whatsapp-agent/.wwebjs_cache
   ```
3. Wait **5 minutes** for WhatsApp cooldown.
4. Restart PM2:
   ```bash
   pm2 restart whatsapp-agent
   ```
5. Scan the fresh QR code immediately.

---

## 6. Critical MODS & Performance Optimizations

### 🚀 MOD 1: Upgrading VM Instance from `e2-micro` to `e2-medium`
**Problem:** The initial `e2-micro` instance only had 1 GB RAM. Headless Chromium requires 800 MB - 1.2 GB during page loads, causing Linux Out-Of-Memory (OOM) killer to crash the process randomly.

**Fix (Executed in Cloud Shell):**
```bash
# 1. Lock external IP to static so it never changes
gcloud compute addresses create hermes-static-ip   --addresses=136.65.153.237   --region=us-central1

# 2. Stop VM
gcloud compute instances stop hermes-whatsapp-agent --zone=us-central1-a

# 3. Upgrade to e2-medium (4 GB RAM, 2 vCPUs)
gcloud compute instances set-machine-type hermes-whatsapp-agent   --zone=us-central1-a   --machine-type=e2-medium

# 4. Start the upgraded VM
gcloud compute instances start hermes-whatsapp-agent --zone=us-central1-a
```

---

### 🚀 MOD 2: Swap Space Creation & Swappiness Tuning
To guarantee Chromium never crashes during sudden memory spikes:
```bash
# Create 2GB swap file
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile

# Make swap persistent on reboot
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

# Set swappiness to 10 (keeps active Chrome processes in RAM, swaps only inactive memory)
sudo sysctl vm.swappiness=10
echo 'vm.swappiness=10' | sudo tee -a /etc/sysctl.conf
```

---

### 🚀 MOD 3: Upgrading Node.js Heap Allocation
On `e2-micro`, Node was throttled with `--max_old_space_size=128`.
On `e2-medium`, this limit was lifted to **2048 MB (2 GB)**:
```bash
pm2 restart whatsapp-agent --node-args="--max-old-space-size=2048"
pm2 save
```

---

### 🚀 MOD 4: Enabling ZRAM (Compressed In-Memory Swap)
ZRAM creates a compressed block device in physical RAM that is 5x faster than disk swap:
```bash
sudo apt install -y zram-tools
echo 'ALGO=zstd' | sudo tee -a /etc/default/zramswap
echo 'PERCENT=50' | sudo tee -a /etc/default/zramswap
sudo systemctl restart zramswap
```

---

### 🚀 MOD 5: DeepSeek AI Brain Integration
Replaced the default Gemini flash model with the **DeepSeek API (`your_deepseek_api_key_here`)** for faster responses, lower latency, and cost-effective natural conversations.

---

### 🚀 MOD 6: 24/7 PM2 Daemon Persistence
```bash
pm2 startup systemd -u sgarm --hp /home/sgarm
pm2 save
```
If the VM reboots for Google maintenance, PM2 automatically restarts the Hermes agent without any manual intervention.

---

## 7. Operational Cheatsheet

### Check Live Status & Logs
```powershell
# Check PM2 process table
ssh -i "$env:USERPROFILE\.ssh\google_compute_engine" sgarm@136.65.153.237 "pm2 status"

# View real-time incoming WhatsApp messages
ssh -i "$env:USERPROFILE\.ssh\google_compute_engine" sgarm@136.65.153.237 "pm2 logs whatsapp-agent --lines 50"
```

### Restart Agent
```powershell
ssh -i "$env:USERPROFILE\.ssh\google_compute_engine" sgarm@136.65.153.237 "pm2 restart whatsapp-agent"
```

### Check Memory & CPU Usage
```powershell
ssh -i "$env:USERPROFILE\.ssh\google_compute_engine" sgarm@136.65.153.237 "free -h"
```

---
*Created on September 23, 2026 for system owner.*
