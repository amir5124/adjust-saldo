'use strict';

// Load environment variables
require('dotenv').config();

const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const cors = require('cors');
const moment = require('moment-timezone');
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const twilio = require('twilio');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// ============================================================
// KONFIGURASI - DARI ENVIRONMENT VARIABLES
// ============================================================
const API_KEY_JAGEL = process.env.JAGEL_APIKEY || "c6wA9HlUkN2PYEpEOYmDwiehrw7QMIVAvPETMpR2NRN4jjnYPO";
const JAGEL_BASE_URL = process.env.JAGEL_BASE_URL || "https://api.jagel.id/v1";

const CONFIG = {
    clientId: process.env.LINKQU_CLIENT_ID || 'testing',
    clientSecret: process.env.LINKQU_CLIENT_SECRET || '123',
    username: process.env.LINKQU_USERNAME || 'LI307GXIN',
    pin: process.env.LINKQU_PIN || '2K2NPCBBNNTovgB',
    serverKey: process.env.LINKQU_SERVER_KEY || 'LinkQu@2020',
    callbackUrl: process.env.CALLBACK_URL || 'https://jagel.siappgo.id/callback',
    MUDICOUrl: process.env.MUDICO_URL || 'https://mudico.my.id/mudico.php',
    jagelApiKey: process.env.JAGEL_APIKEY || 'q2t7lktZkZIEiCDs7y9HpWP0WCRdABEGTrHidEUhrAMe0IDzXV',
    linkquGateway: process.env.LINKQU_GATEWAY || 'https://gateway-dev.linkqu.id/linkqu-partner',
    jagelBaseUrl: process.env.JAGEL_BASE_URL || 'https://api.jagel.id/v1',
    port: parseInt(process.env.PORT || '3000'),

    // Twilio Configuration
    twilioSid: process.env.TWILIO_ACCOUNT_SID || '',
    twilioAuth: process.env.TWILIO_AUTH_TOKEN || '',
    twilioWaNumber: process.env.TWILIO_WHATSAPP_NUMBER || 'whatsapp:+14155238886',
    adminWaNumber: process.env.ADMIN_WHATSAPP_NUMBER || 'whatsapp:+6282323907426',
    csNumber: process.env.CS_PHONE_NUMBER || '6282226666610',
    baseUrl: process.env.BASE_URL || 'http://localhost:3000',

    // Twilio Content Template SIDs (Approved)
    templateDriverConfirmation: process.env.TWILIO_TEMPLATE_DRIVER_CONFIRMATION || 'HX0f899a4bc82aca9611ef757228c3ba61',
    templateDriverOrderAccepted: process.env.TWILIO_TEMPLATE_DRIVER_ACCEPTED || 'HX59e4eb4a2e31316585b76a3fbb2bfc8d',
    templateCustomerOrderConfirmed: process.env.TWILIO_TEMPLATE_CUSTOMER_CONFIRMED || 'HX9e996a15a5f28fb3ec2cdd7d84ab85a2',
    templateDriverRejected: process.env.TWILIO_TEMPLATE_DRIVER_REJECTED || 'HX883e49ca163a114e5674f0be7dd53bec',
    templateNoDriverAvailable: process.env.TWILIO_TEMPLATE_NO_DRIVER || 'HX83dfee2050db21b4b4ffc571c31690da'
};

// ============================================================
// TWILIO INITIALIZATION WITH DETAILED LOGS
// ============================================================
let twilioClient = null;

function initTwilio() {
    console.log('\n🔧 [TWILIO] Initializing...');
    console.log(`   TWILIO_ACCOUNT_SID: ${CONFIG.twilioSid ? '✅ SET (' + CONFIG.twilioSid.substring(0, 10) + '...)' : '❌ MISSING'}`);
    console.log(`   TWILIO_AUTH_TOKEN: ${CONFIG.twilioAuth ? '✅ SET (' + CONFIG.twilioAuth.substring(0, 10) + '...)' : '❌ MISSING'}`);
    console.log(`   TWILIO_WHATSAPP_NUMBER: ${CONFIG.twilioWaNumber}`);

    if (!CONFIG.twilioSid || !CONFIG.twilioAuth) {
        console.error('\n❌❌❌ TWILIO CREDENTIALS MISSING! ❌❌❌');
        console.error('Please set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN in .env file');
        console.error('WhatsApp messages will NOT be sent!\n');
        return null;
    }

    try {
        twilioClient = twilio(CONFIG.twilioSid, CONFIG.twilioAuth);
        console.log('✅ Twilio client initialized successfully!');
        console.log(`   WhatsApp Business Number: ${CONFIG.twilioWaNumber}`);
        console.log(`   Templates ready: ${Object.keys(CONFIG).filter(k => k.startsWith('template')).length} templates\n`);
        return twilioClient;
    } catch (error) {
        console.error('❌ Failed to initialize Twilio client:', error.message);
        return null;
    }
}

// Panggil initTwilio di awal
initTwilio();

// ============================================================
// DATABASE POOL
// ============================================================
const pool = mysql.createPool({
    host: process.env.DB_HOST || 'e8gsoo4w4gg8oo4s8skscowo',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'IvlI9h6kMJfOGOov6YYpuCdQ3fOcITZ59iDmw225iJwtV9aVOTUDTzxHlTa7pOjN',
    database: process.env.DB_NAME || 'orderwa',
    port: parseInt(process.env.DB_PORT || '3306'),
    connectTimeout: 30000,
    connectionLimit: 10,
    waitForConnections: true,
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 10000,
});

// ============================================================
// LOGGER
// ============================================================
const driverConfirmations = new Map();
const LOG_DIR = path.join(__dirname, 'logs');
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

function logToFile(message, type = 'INFO') {
    const timestamp = new Date().toISOString();
    const logPath = path.join(LOG_DIR, `${type.toLowerCase()}.log`);
    const logMessage = `[${timestamp}] [${type}] ${message}\n`;
    fs.appendFile(logPath, logMessage, (err) => {
        if (err) console.error('Gagal write log:', err.message);
    });
    console.log(logMessage.trim());
}

// ============================================================
// TEST KONEKSI DATABASE
// ============================================================
async function testDatabaseConnection() {
    console.log('\n🔍 Testing database connection...');

    try {
        const connection = await pool.getConnection();
        const [rows] = await connection.query(
            'SELECT VERSION() as version, NOW() as now, DATABASE() as db, USER() as user'
        );
        console.log('✅ DATABASE CONNECTED!');
        console.log(`   MySQL Version: ${rows[0].version}`);
        console.log(`   Server Time:   ${rows[0].now}`);
        console.log(`   Database:      ${rows[0].db}`);
        console.log(`   User:          ${rows[0].user}`);

        const [tables] = await connection.query(`
            SELECT TABLE_NAME FROM information_schema.TABLES
            WHERE TABLE_SCHEMA = ?
            AND TABLE_NAME IN ('inquiry_va','inquiry_qris','orders','drivers')
        `, [rows[0].db]);

        const existing = tables.map(t => t.TABLE_NAME);
        console.log(`   Tables found: ${existing.join(', ') || 'none'}`);
        for (const t of ['inquiry_va', 'inquiry_qris', 'orders', 'drivers']) {
            if (!existing.includes(t)) console.warn(`⚠️  Table ${t} missing!`);
        }
        connection.release();
        return true;
    } catch (err) {
        console.error('❌ DATABASE CONNECTION FAILED!');
        console.error(`   Error: ${err.message}`);
        console.error(`   Code:  ${err.code}`);
        return false;
    }
}

let dbReady = false;
testDatabaseConnection().then(result => {
    dbReady = result;
    if (!dbReady) console.error('\n⚠️ WARNING: Database not ready! API will not save data.');
});

// ============================================================
// HELPER FUNCTIONS
// ============================================================
function generateCustomerId() {
    const timestamp = Date.now().toString().slice(-5);
    const random = Math.floor(Math.random() * 90000 + 10000).toString();
    return timestamp + random;
}

function getExpiredTimestamp(minutes = 15) {
    return moment.tz('Asia/Jakarta').add(minutes, 'minutes').format('YYYYMMDDHHmmss');
}

function generatePartnerReff() {
    const ts = Date.now();
    const rnd = crypto.randomBytes(4).toString('hex');
    return `INV-782372373627-${ts}-${rnd}`;
}

function mysqlNow() {
    return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

function hmac256(serverKey, data) {
    return crypto.createHmac('sha256', serverKey).update(data).digest('hex');
}

function cleanValue(str) {
    return String(str).replace(/[^0-9a-zA-Z]/g, '').toLowerCase();
}

function generateSignatureVA(p) {
    const raw = cleanValue(
        p.amount + p.expired + p.bank_code + p.partner_reff +
        p.customer_id + p.customer_name + p.customer_email + p.clientId
    );
    return hmac256(p.serverKey, '/transaction/create/vaPOST' + raw);
}

function generateSignatureQRIS(p) {
    const raw = cleanValue(
        p.amount + p.expired + p.partner_reff +
        p.customer_id + p.customer_name + p.customer_email + p.clientId
    );
    return hmac256(p.serverKey, '/transaction/create/qrisPOST' + raw);
}

// ============================================================
// NORMALIZE PHONE NUMBER (BEFORE STORING AND COMPARING)
// ============================================================
function normalizePhoneNumber(phoneNumber) {
    if (!phoneNumber) return null;

    // Hapus semua karakter non-digit
    let cleaned = phoneNumber.toString().replace(/\D/g, '');

    // Jika dimulai dengan 0, ganti dengan 62
    if (cleaned.startsWith('0')) {
        cleaned = '62' + cleaned.substring(1);
    }

    // Jika tidak dimulai dengan 62, tambahkan 62
    if (!cleaned.startsWith('62')) {
        cleaned = '62' + cleaned;
    }

    return cleaned;
}

// ============================================================
// HELPER: Panggil Jagel API (app.jagel.id — Bearer token)
// ============================================================
async function callJagelAppApi(url, bearerToken, method = 'GET', data = null) {
    const config = {
        method,
        url,
        headers: {
            'Authorization': `Bearer ${bearerToken}`,
            'Accept': 'application/json',
            'Content-Type': 'application/json',
        },
        timeout: 30000,
        httpsAgent: new (require('https').Agent)({ rejectUnauthorized: false }),
    };
    if (method === 'POST' && data) config.data = data;
    console.log(`🌐 [JAGEL-APP-API] ${method} ${url}`);
    const response = await axios(config);
    console.log(`✅ [JAGEL-APP-API] Status: ${response.status}`);
    return response;
}

// ============================================================
// HELPER: Panggil Jagel API (api.jagel.id — API Key)
// ============================================================
async function callJagelApi(url, data = null, method = 'POST') {
    try {
        const config = {
            method,
            url,
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
            timeout: 30000,
            httpsAgent: new (require('https').Agent)({ rejectUnauthorized: false }),
        };
        if (method === 'POST' && data) config.data = data;
        console.log(`🌐 [JAGEL-API] ${method} ${url}`);
        const response = await axios(config);
        console.log(`✅ [JAGEL-API] Status: ${response.status}`);
        return response;
    } catch (error) {
        if (error.response) {
            console.error(`❌ [JAGEL-API] HTTP ${error.response.status}:`, error.response.data);
            return { data: { success: false, message: `API Error: ${error.response.status} - ${JSON.stringify(error.response.data)}` } };
        }
        console.error(`❌ [JAGEL-API] Error:`, error.message);
        return { data: { success: false, message: `Error: ${error.message}` } };
    }
}

// ============================================================
// FUNGSI ADD BALANCE - SIMPLE VERSION (HARDCODE "amir")
// ============================================================
async function addBalance(amount, customer_name, methodCode, serialnumber) {
    const originalAmount = parseInt(amount);

    // Hitung admin (4.000 untuk VA, 0.8% untuk QRIS)
    let admin = 4000;
    if (methodCode === 'QRIS') {
        admin = Math.round(originalAmount * 0.008);
    }

    const netAmount = originalAmount - admin;
    const username = 'amir'; // ← HARDCODE

    const note = `Pesanan dari ${customer_name} || Rp ${netAmount.toLocaleString('id-ID')} (admin ${admin.toLocaleString('id-ID')}) || ${methodCode === 'QRIS' ? 'QRIS' : 'VA'} || Reff: ${serialnumber}`;

    console.log(`💰 [ADD-BALANCE] ${customer_name} -> ${username} | Amount: ${netAmount} | Admin: ${admin}`);

    try {
        const response = await axios.post(`${CONFIG.jagelBaseUrl}/balance/adjust`, {
            action: 'adjust_balance',
            type: 'username',
            value: username,
            amount: netAmount,
            note: note,
            apikey: CONFIG.jagelApiKey
        }, {
            headers: { 'Content-Type': 'application/json' },
            timeout: 30000
        });

        console.log('✅ Balance added:', response.data);
        return { success: true, data: response.data };

    } catch (error) {
        console.error('❌ Add balance failed:', error.message);
        throw error;
    }
}

// ============================================================
// TWILIO HELPER FUNCTIONS WITH CONTENT TEMPLATE & DETAILED LOGS
// ============================================================

// Format phone number to WhatsApp format
function formatWhatsAppNumber(phoneNumber) {
    if (!phoneNumber) {
        console.error('❌ Empty phone number provided');
        return null;
    }

    let cleaned = phoneNumber.toString().replace(/\D/g, '');

    if (cleaned.length < 10) {
        console.error(`❌ Invalid phone number: ${phoneNumber} (too short)`);
        return null;
    }

    if (!cleaned.startsWith('62')) {
        if (cleaned.startsWith('0')) {
            cleaned = '62' + cleaned.substring(1);
        } else {
            cleaned = '62' + cleaned;
        }
    }

    const formatted = `whatsapp:${cleaned}`;
    console.log(`📱 Formatted: ${phoneNumber} -> ${formatted}`);
    return formatted;
}

// Send WhatsApp message using Content Template (for business-initiated)
async function sendWhatsAppTemplate(to, templateSid, variables) {
    console.log(`\n📤 [SEND-TEMPLATE] Starting...`);
    console.log(`   To: ${to}`);
    console.log(`   Template SID: ${templateSid}`);
    console.log(`   Variables:`, JSON.stringify(variables, null, 2));

    // Validasi Twilio client
    if (!twilioClient) {
        console.error('❌ Twilio client not initialized! Attempting to re-initialize...');
        initTwilio();
        if (!twilioClient) {
            console.error('❌ Twilio client still not available! Check your .env file!');
            return { success: false, error: 'Twilio client not initialized', mock: true };
        }
    }

    // Validasi nomor tujuan
    const whatsappTo = formatWhatsAppNumber(to);
    if (!whatsappTo) {
        return { success: false, error: 'Invalid phone number' };
    }

    // Validasi template SID
    if (!templateSid || !templateSid.startsWith('HX')) {
        console.error(`❌ Invalid template SID: ${templateSid}`);
        return { success: false, error: 'Invalid template SID' };
    }

    try {
        console.log(`📱 [TEMPLATE] Sending to: ${whatsappTo}`);

        const result = await twilioClient.messages.create({
            from: CONFIG.twilioWaNumber,
            to: whatsappTo,
            contentSid: templateSid,
            contentVariables: JSON.stringify(variables)
        });

        console.log(`✅ Template sent successfully!`);
        console.log(`   Message SID: ${result.sid}`);
        console.log(`   Status: ${result.status}`);

        return { success: true, sid: result.sid, status: result.status };

    } catch (error) {
        console.error('❌ Twilio template error:', error.message);

        // Detail error berdasarkan kode
        if (error.code === 63016) {
            console.error('   ⚠️ Template not approved or invalid Content SID!');
            console.error('   Check template status in Twilio Console');
        }
        if (error.code === 21211) {
            console.error('   ⚠️ Invalid phone number format!');
            console.error(`   Make sure ${to} is a valid WhatsApp number`);
        }
        if (error.code === 21610) {
            console.error('   ⚠️ The phone number is not opted in to WhatsApp!');
            console.error(`   Customer must send "join" to ${CONFIG.twilioWaNumber} first`);
        }
        if (error.code === 63007) {
            console.error('   ⚠️ Template language not supported or invalid');
        }

        return { success: false, error: error.message, code: error.code };
    }
}

// Send free-form message (ONLY for replies within 24-hour window)
async function sendWhatsAppFreeForm(to, message) {
    console.log(`\n📤 [SEND-FREE-FORM] Starting...`);
    console.log(`   To: ${to}`);
    console.log(`   Message: ${message.substring(0, 100)}${message.length > 100 ? '...' : ''}`);

    if (!twilioClient) {
        console.error('❌ Twilio client not initialized!');
        return { success: false, error: 'Twilio client not initialized' };
    }

    const whatsappTo = formatWhatsAppNumber(to);
    if (!whatsappTo) {
        return { success: false, error: 'Invalid phone number' };
    }

    try {
        const result = await twilioClient.messages.create({
            from: CONFIG.twilioWaNumber,
            to: whatsappTo,
            body: message
        });

        console.log(`✅ Free-form sent, SID: ${result.sid}`);
        return { success: true, sid: result.sid };

    } catch (error) {
        console.error('❌ Free-form error:', error.message);
        return { success: false, error: error.message };
    }
}

// Format Rupiah
function formatRupiah(amount) {
    return new Intl.NumberFormat('id-ID', {
        style: 'currency',
        currency: 'IDR',
        minimumFractionDigits: 0
    }).format(amount);
}

// ============================================================
// ENDPOINT: GET /test-twilio (UNTUK TESTING TWILIO)
// ============================================================
app.get('/test-twilio', async (req, res) => {
    console.log('\n🧪 [TEST-TWILIO] Testing Twilio configuration...');

    const testNumber = req.query.to || '';
    const testTemplate = req.query.template || CONFIG.templateDriverConfirmation;

    const result = {
        success: true,
        timestamp: new Date().toISOString(),
        twilio_configured: !!(CONFIG.twilioSid && CONFIG.twilioAuth),
        twilio_client_ready: !!twilioClient,
        whatsapp_number: CONFIG.twilioWaNumber,
        templates: {
            driver_confirmation: CONFIG.templateDriverConfirmation,
            driver_accepted: CONFIG.templateDriverOrderAccepted,
            customer_confirmed: CONFIG.templateCustomerOrderConfirmed,
            driver_rejected: CONFIG.templateDriverRejected,
            no_driver: CONFIG.templateNoDriverAvailable
        }
    };

    // Jika ada nomor tujuan, coba kirim test message
    if (testNumber && req.query.send === 'true') {
        console.log(`📤 [TEST] Attempting to send test message to ${testNumber}`);

        const testVariables = {
            "1": "Test Driver",
            "2": "Test Customer",
            "3": "Rp 10.000",
            "4": "1"
        };

        const sendResult = await sendWhatsAppTemplate(testNumber, testTemplate, testVariables);
        result.test_send = sendResult;
    }

    res.json(result);
});

// ============================================================
// ENDPOINT: POST /adjust.php (Jagel action handler)
// ============================================================
app.post('/adjust.php', async (req, res) => {
    console.log('\n📥 [ADJUST] Request received:', JSON.stringify(req.body, null, 2));

    try {
        const { action, value, amount, note, content } = req.body;

        if (!action) {
            console.warn('⚠️ [ADJUST] Missing action param');
            return res.json({ success: false, message: 'Metode aksi tidak ditentukan' });
        }

        console.log(`🔍 [ADJUST] action="${action}" value="${value}"`);

        let apiUrl = '';
        let payload = null;
        let method = 'GET';

        switch (action) {
            case 'check_balance':
                apiUrl = `${JAGEL_BASE_URL}/balance/check?type=username&value=${encodeURIComponent(value)}&apikey=${API_KEY_JAGEL}`;
                method = 'GET';
                console.log(`💰 [ADJUST] check_balance for: ${value}`);
                break;

            case 'adjust_balance':
                apiUrl = `${JAGEL_BASE_URL}/balance/adjust`;
                const cleanAmt = Math.round(Math.abs(parseFloat(amount || 0))) * (amount < 0 ? -1 : 1);
                payload = { type: 'username', value, amount: cleanAmt, note: note || 'Ship Booking', apikey: API_KEY_JAGEL };
                method = 'POST';
                console.log(`💸 [ADJUST] adjust_balance for: ${value}, amount: ${cleanAmt}`);
                break;

            case 'send_message':
                apiUrl = `${JAGEL_BASE_URL}/message/send`;
                payload = { type: 'username', value, content: content || '', apikey: API_KEY_JAGEL };
                method = 'POST';
                console.log(`📨 [ADJUST] send_message to: ${value}`);
                break;

            case 'confirm_payment':
                apiUrl = `${JAGEL_BASE_URL}/confirmPayment`;
                payload = { amount: Math.round(Math.abs(parseFloat(amount || 0))), apikey: API_KEY_JAGEL };
                method = 'POST';
                console.log(`✅ [ADJUST] confirm_payment, amount: ${amount}`);
                break;

            case 'get_user':
                apiUrl = `${JAGEL_BASE_URL}/user`;
                const utype = req.body.type || 'username';
                payload = { type: utype, value, apikey: API_KEY_JAGEL };
                method = 'POST';
                console.log(`👤 [ADJUST] get_user: type=${utype}, value=${value}`);
                break;

            default:
                console.warn(`⚠️ [ADJUST] Unknown action: "${action}"`);
                return res.json({ success: false, message: 'Aksi tidak dikenal' });
        }

        console.log(`📤 [ADJUST] Calling Jagel API: ${method} ${apiUrl}`);
        if (payload) console.log(`   Payload:`, JSON.stringify(payload));

        const response = await callJagelApi(apiUrl, payload, method);
        console.log(`✅ [ADJUST] Response:`, JSON.stringify(response.data));

        return res.json(response.data);

    } catch (error) {
        console.error('❌ [ADJUST] Error:', error.message);
        return res.json({ success: false, message: error.message || 'Internal Server Error' });
    }
});

// ============================================================
// ENDPOINT: POST /create-va
// ============================================================
app.post('/create-va', async (req, res) => {
    console.log('\n📝 [CREATE-VA] Request received:', JSON.stringify(req.body, null, 2));

    if (!dbReady) return res.status(503).json({ error: 'Database not ready' });

    try {
        const body = req.body;

        let customerId = body.customer_id;
        if (!customerId || customerId === '') {
            customerId = generateCustomerId();
            console.log(`🔑 [CREATE-VA] Generated customer_id: ${customerId}`);
        }

        const partner_reff = generatePartnerReff();
        const expired = getExpiredTimestamp();

        const bankCode = body.bank_code || '008';

        const signature = generateSignatureVA({
            amount: body.amount,
            expired,
            bank_code: bankCode,
            partner_reff,
            customer_id: customerId,
            customer_name: body.customer_name,
            customer_email: body.customer_email,
            clientId: CONFIG.clientId,
            serverKey: CONFIG.serverKey,
        });

        const payload = {
            amount: body.amount,
            bank_code: bankCode,
            customer_id: customerId,
            customer_name: body.customer_name,
            customer_email: body.customer_email,
            customer_phone: body.customer_phone || '',
            partner_reff,
            username: CONFIG.username,
            pin: CONFIG.pin,
            expired,
            signature,
            url_callback: CONFIG.callbackUrl,
            remark: `VA ${bankCode}`
        };

        const response = await axios.post(
            `${CONFIG.linkquGateway}/transaction/create/va`, payload,
            { headers: { 'client-id': CONFIG.clientId, 'client-secret': CONFIG.clientSecret }, timeout: 30000 }
        );

        const result = response.data;
        const vaNumber = result.virtual_account || null;
        const isSuccess = result.status === 'SUCCESS' || result.response_code === '00';

        await pool.execute(`
            INSERT INTO inquiry_va
            (partner_reff, customer_name, customer_phone, customer_email, 
             bank_code, va_number, amount, expired, response_raw, created_at, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            partner_reff,
            body.customer_name,
            body.customer_phone || null,
            body.customer_email,
            bankCode,
            vaNumber,
            body.amount,
            expired,
            JSON.stringify(result),
            mysqlNow(),
            isSuccess ? 'PENDING' : 'FAILED'
        ]);

        res.json({ ...result, partner_reff, customer_id: customerId, db_saved: true });

    } catch (err) {
        console.error('❌ [CREATE-VA] Error:', err.message);
        if (err.response) console.error('   API Error:', JSON.stringify(err.response.data));
        res.status(500).json({ error: 'Failed to create VA', detail: err.message });
    }
});

// ============================================================
// ENDPOINT: POST /create-qris
// ============================================================
app.post('/create-qris', async (req, res) => {
    console.log('\n📝 [CREATE-QRIS] Request received:', JSON.stringify(req.body, null, 2));

    if (!dbReady) return res.status(503).json({ error: 'Database not ready' });

    try {
        const body = req.body;

        let customerId = body.customer_id;
        if (!customerId || customerId === '') {
            customerId = generateCustomerId();
            console.log(`🔑 [CREATE-QRIS] Generated customer_id: ${customerId}`);
        }

        const partner_reff = generatePartnerReff();
        const expired = getExpiredTimestamp();

        const signature = generateSignatureQRIS({
            amount: body.amount,
            expired,
            partner_reff,
            customer_id: customerId,
            customer_name: body.customer_name,
            customer_email: body.customer_email,
            clientId: CONFIG.clientId,
            serverKey: CONFIG.serverKey,
        });

        const payload = {
            amount: body.amount,
            customer_id: customerId,
            customer_name: body.customer_name,
            customer_email: body.customer_email,
            customer_phone: body.customer_phone || '',
            partner_reff,
            username: CONFIG.username,
            pin: CONFIG.pin,
            expired,
            signature,
            url_callback: CONFIG.callbackUrl,
        };

        const response = await axios.post(
            `${CONFIG.linkquGateway}/transaction/create/qris`, payload,
            { headers: { 'client-id': CONFIG.clientId, 'client-secret': CONFIG.clientSecret }, timeout: 30000 }
        );

        const result = response.data;
        let qrisImageBuffer = null;

        if (result?.imageqris) {
            try {
                const imgResp = await axios.get(result.imageqris.trim(), { responseType: 'arraybuffer', timeout: 10000 });
                qrisImageBuffer = Buffer.from(imgResp.data);
            } catch (imgErr) {
                console.warn('⚠️ [CREATE-QRIS] Failed to download QR image:', imgErr.message);
            }
        }

        const isSuccess = result.status === 'SUCCESS' || result.response_code === '00';

        await pool.execute(`
            INSERT INTO inquiry_qris
            (partner_reff, customer_id, customer_name, amount, expired,
             customer_phone, customer_email, qris_url, qris_image, response_raw, created_at, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            partner_reff,
            customerId,
            body.customer_name,
            body.amount,
            expired,
            body.customer_phone || null,
            body.customer_email,
            result?.imageqris || null,
            qrisImageBuffer,
            JSON.stringify(result),
            mysqlNow(),
            isSuccess ? 'PENDING' : 'FAILED'
        ]);

        res.json({ ...result, partner_reff, customer_id: customerId, db_saved: true });

    } catch (err) {
        console.error('❌ [CREATE-QRIS] Error:', err.message);
        if (err.response) console.error('   API Error:', JSON.stringify(err.response.data));
        res.status(500).json({ error: 'Failed to create QRIS', detail: err.message });
    }
});

// ============================================================
// FUNGSI UPDATE ORDER STATUS DARI CALLBACK
// ============================================================
async function updateOrderStatusFromCallback(partner_reff, paymentStatus) {
    try {
        // Update status pembayaran di tabel orders
        const [result] = await pool.execute(
            `UPDATE orders 
             SET payment_status = ?, 
                 order_status = CASE 
                     WHEN order_status = 'PENDING' AND ? = 'PAID' THEN 'SEARCHING'
                     ELSE order_status 
                 END,
                 updated_at = ?
             WHERE partner_reff = ?`,
            [paymentStatus, paymentStatus, mysqlNow(), partner_reff]
        );

        if (result.affectedRows > 0) {
            console.log(`✅ Order status updated for partner_reff: ${partner_reff} to ${paymentStatus}`);

            // Ambil detail order untuk notifikasi
            const [orders] = await pool.execute(
                'SELECT * FROM orders WHERE partner_reff = ?',
                [partner_reff]
            );

            if (orders.length > 0) {
                const order = orders[0];

                // Kirim notifikasi ke customer bahwa pembayaran berhasil
                await sendPaymentSuccessNotification(order);
            }

            return true;
        } else {
            console.log(`⚠️ No order found with partner_reff: ${partner_reff}`);
            return false;
        }
    } catch (error) {
        console.error('❌ Error updating order status:', error.message);
        return false;
    }
}

// ============================================================
// FUNGSI KIRIM NOTIFIKASI PEMBAYARAN SUKSES
// ============================================================
async function sendPaymentSuccessNotification(order) {
    console.log(`📧 [PAYMENT-NOTIFICATION] Order: ${order.order_id}`);

    try {
        const message = `✅ *PEMBAYARAN BERHASIL!*
━━━━━━━━━━━━━━━━━━━━━
Halo *${order.customer_name}*,

Pembayaran Anda sebesar *${formatRupiah(order.total_price)}* telah berhasil.

Status pesanan: *${order.order_status}*
Order ID: ${order.order_id}

Kami akan segera mencari driver terdekat untuk pesanan Anda.

Terima kasih! 🙏`;

        await sendWhatsAppFreeForm(order.customer_phone, message);
        console.log(`✅ Payment notification sent to customer`);
    } catch (error) {
        console.error('❌ Error sending payment notification:', error.message);
    }
}

// ============================================================
// ENDPOINT: POST /callback
// ============================================================
app.post('/callback', async (req, res) => {
    console.log('\n📞 [CALLBACK] ============================================');
    console.log('📞 [CALLBACK] Payload:', JSON.stringify(req.body, null, 2));

    const { partner_reff, serialnumber, status, transaction_status } = req.body;

    if (!partner_reff) {
        logToFile('Missing partner_reff', 'ERROR');
        return res.status(400).json({ error: 'partner_reff wajib ada' });
    }

    console.log(`🔍 [CALLBACK] Processing: ${partner_reff}`);
    const connection = await pool.getConnection();

    let tableName = null;
    let dbData = null;

    try {
        await connection.beginTransaction();

        let [rows] = await connection.execute(
            `SELECT status, customer_name, amount, bank_code as method_code, 'VA' as type FROM inquiry_va WHERE partner_reff = ? FOR UPDATE`,
            [partner_reff]
        );
        if (rows.length > 0) {
            tableName = 'inquiry_va';
            dbData = rows[0];
            console.log(`✅ [CALLBACK] Found in inquiry_va: status=${dbData.status}`);
        }

        if (!tableName) {
            [rows] = await connection.execute(
                `SELECT status, customer_name, amount, 'QRIS' as method_code, 'QRIS' as type FROM inquiry_qris WHERE partner_reff = ? FOR UPDATE`,
                [partner_reff]
            );
            if (rows.length > 0) {
                tableName = 'inquiry_qris';
                dbData = rows[0];
                console.log(`✅ [CALLBACK] Found in inquiry_qris: status=${dbData.status}`);
            }
        }

        if (!tableName || !dbData) {
            await connection.rollback();
            console.error(`❌ [CALLBACK] Transaction not found: ${partner_reff}`);
            logToFile(`Transaction not found: ${partner_reff}`, 'ERROR');
            return res.status(404).json({ error: 'Data transaksi tidak ditemukan' });
        }

        if (dbData.status === 'SUKSES') {
            await connection.rollback();
            console.log(`ℹ️ [CALLBACK] Already SUKSES, skip: ${partner_reff}`);
            return res.json({ message: 'Sudah diproses sebelumnya.' });
        }

        await connection.execute(
            `UPDATE ${tableName} SET status = 'SUKSES' WHERE partner_reff = ?`,
            [partner_reff]
        );
        await connection.commit();
        console.log(`✅ [CALLBACK] DB updated to SUKSES for ${partner_reff}`);

        let methodCode = dbData.method_code;
        if (dbData.type === 'RETAIL') methodCode = (methodCode || 'RETAIL').toUpperCase();

        console.log(`💰 [CALLBACK] addBalance: user=${dbData.customer_name}, amount=${dbData.amount}, method=${methodCode}`);

        await addBalance(dbData.amount, dbData.customer_name, methodCode, serialnumber || partner_reff);

        // ✅ TAMBAHKAN: Update status order di tabel orders
        await updateOrderStatusFromCallback(partner_reff, 'PAID');

        console.log(`🎉 [CALLBACK] SUCCESS: Saldo ditambahkan untuk ${dbData.customer_name} via ${methodCode}`);
        res.json({ message: 'Callback diterima dan saldo ditambahkan' });

    } catch (err) {
        console.error(`❌ [CALLBACK] Error in try block:`, err.message);

        try {
            if (tableName) {
                await connection.execute(
                    `UPDATE ${tableName} SET status = 'PENDING' WHERE partner_reff = ?`,
                    [partner_reff]
                );
                await connection.commit();
                console.warn(`⚠️ [CALLBACK] Rolled back to PENDING for ${partner_reff}`);
            } else {
                await connection.rollback();
                console.warn(`⚠️ [CALLBACK] Rollback transaction (no table found)`);
            }
        } catch (rbErr) {
            console.error(`❌ [CALLBACK] Rollback failed: ${rbErr.message}`);
            try {
                await connection.rollback();
            } catch (finalErr) {
                console.error(`❌ [CALLBACK] Final rollback failed: ${finalErr.message}`);
            }
        }

        logToFile(`❌ Callback Error [${partner_reff}]: ${err.message}`, 'ERROR');
        console.error(`❌ [CALLBACK] Error: ${err.message}`);
        res.status(500).json({ error: 'Internal Server Error', detail: err.message });

    } finally {
        connection.release();
        console.log(`🔓 [CALLBACK] Connection released for ${partner_reff}`);
    }
});

// ============================================================
// ENDPOINT: POST /sync-all-orders (untuk sync data lama)
// ============================================================
app.post('/sync-all-orders', async (req, res) => {
    console.log('🔄 Syncing all orders...');

    try {
        // Ambil semua order dengan payment_status = 'PAID' tapi order_status masih 'PENDING'
        const [orders] = await pool.execute(`
            SELECT * FROM orders 
            WHERE payment_status = 'PAID' AND order_status = 'PENDING'
        `);

        console.log(`Found ${orders.length} orders to sync`);

        let updated = 0;
        for (const order of orders) {
            // Update status ke SEARCHING atau CONFIRMED jika sudah ada driver
            const newStatus = order.driver_id ? 'CONFIRMED' : 'SEARCHING';
            await pool.execute(`
                UPDATE orders 
                SET order_status = ?, updated_at = ?
                WHERE order_id = ?
            `, [newStatus, mysqlNow(), order.order_id]);
            updated++;
            console.log(`✅ Synced order ${order.order_id} -> ${newStatus}`);
        }

        res.json({
            success: true,
            message: `Synced ${updated} orders`,
            total_found: orders.length,
            updated: updated
        });

    } catch (error) {
        console.error('Sync error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ============================================================
// ENDPOINT: POST /sync-order-status (sinkronisasi manual)
// ============================================================
app.post('/sync-order-status', async (req, res) => {
    const { partner_reff } = req.body;

    if (!partner_reff) {
        return res.status(400).json({ error: 'partner_reff required' });
    }

    try {
        // Cek status dari inquiry_va atau inquiry_qris
        let [vaRows] = await pool.execute(
            'SELECT status FROM inquiry_va WHERE partner_reff = ?',
            [partner_reff]
        );

        let paymentStatus = null;
        if (vaRows.length > 0 && vaRows[0].status === 'SUKSES') {
            paymentStatus = 'PAID';
        }

        if (!paymentStatus) {
            let [qrisRows] = await pool.execute(
                'SELECT status FROM inquiry_qris WHERE partner_reff = ?',
                [partner_reff]
            );
            if (qrisRows.length > 0 && qrisRows[0].status === 'SUKSES') {
                paymentStatus = 'PAID';
            }
        }

        if (paymentStatus) {
            await updateOrderStatusFromCallback(partner_reff, paymentStatus);
            res.json({ success: true, message: 'Order status synchronized', status: paymentStatus });
        } else {
            res.json({ success: false, message: 'Payment not found or not successful' });
        }

    } catch (error) {
        console.error('❌ Sync error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ============================================================
// ENDPOINT: GET /download-qr/:partner_reff
// ============================================================
app.get('/download-qr/:partner_reff', async (req, res) => {
    const { partner_reff } = req.params;

    try {
        const [rows] = await pool.execute(
            'SELECT qris_image, qris_url FROM inquiry_qris WHERE partner_reff = ?',
            [partner_reff]
        );

        if (!rows.length) {
            return res.status(404).send('QRIS tidak ditemukan');
        }

        if (rows[0].qris_image) {
            res.setHeader('Content-Disposition', `attachment; filename="qris-${partner_reff}.png"`);
            res.setHeader('Content-Type', 'image/png');
            return res.send(rows[0].qris_image);
        }

        if (!rows[0].qris_url) {
            return res.status(404).send('URL QRIS tidak tersedia');
        }

        const imgResp = await axios.get(rows[0].qris_url.trim(), { responseType: 'arraybuffer', timeout: 10000 });
        const buffer = Buffer.from(imgResp.data);

        await pool.execute('UPDATE inquiry_qris SET qris_image = ? WHERE partner_reff = ?', [buffer, partner_reff]);

        res.setHeader('Content-Disposition', `attachment; filename="qris-${partner_reff}.png"`);
        res.setHeader('Content-Type', 'image/png');
        res.send(buffer);

    } catch (err) {
        console.error('❌ [DOWNLOAD-QR] Error:', err.message);
        res.status(500).send('Terjadi kesalahan server');
    }
});

// ============================================================
// ENDPOINT: GET /check-status/:partner_reff
// ============================================================
app.get('/check-status/:partner_reff', async (req, res) => {
    const { partner_reff } = req.params;

    if (!partner_reff) return res.status(400).json({ rc: '01', message: 'partner_reff diperlukan' });

    try {
        let transaction = null;

        let [rows] = await pool.execute(
            'SELECT partner_reff, status, amount, bank_code as method, created_at FROM inquiry_va WHERE partner_reff = ?',
            [partner_reff]
        );
        if (rows.length > 0) { transaction = { ...rows[0], type: 'VA' }; }

        if (!transaction) {
            [rows] = await pool.execute(
                'SELECT partner_reff, status, amount, created_at FROM inquiry_qris WHERE partner_reff = ?',
                [partner_reff]
            );
            if (rows.length > 0) { transaction = { ...rows[0], type: 'QRIS', method: 'QRIS' }; }
        }

        if (!transaction) {
            return res.status(404).json({ rc: '404', message: 'Transaksi tidak ditemukan', data: null });
        }

        const status_trx = transaction.status === 'SUKSES' ? 'success' : 'pending';

        res.json({
            rc: '00', message: 'Success',
            data: {
                partner_reff: transaction.partner_reff,
                type: transaction.type,
                method: transaction.method,
                status_trx,
                status_db: transaction.status,
                amount: transaction.amount,
                created_at: transaction.created_at,
                checked_at: new Date().toISOString(),
            },
        });

    } catch (err) {
        console.error('❌ [CHECK-STATUS] Error:', err.message);
        res.status(500).json({ rc: '99', message: 'Internal server error', error: err.message });
    }
});

// ============================================================
// ENDPOINT: POST /add-balance (manual trigger)
// ============================================================
app.post('/add-balance', async (req, res) => {
    const { amount, username, method_code, serial_number } = req.body;

    if (!amount || !username) {
        return res.status(400).json({ success: false, message: 'amount dan username wajib diisi' });
    }

    try {
        const result = await addBalance(
            amount, username,
            (method_code || 'VA').toUpperCase(),
            serial_number || `MANUAL-${Date.now()}`
        );
        res.json({ success: true, ...result });
    } catch (err) {
        console.error('❌ [ADD-BALANCE-MANUAL] Error:', err.message);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ============================================================
// ENDPOINT: POST /orders (buat order baru)
// ============================================================
// ============================================================
// ENDPOINT: POST /orders (buat order baru) - UPDATED
// ============================================================
app.post('/orders', async (req, res) => {
    console.log('\n🛒 [ORDERS-CREATE] Request received:', JSON.stringify(req.body, null, 2));

    if (!dbReady) return res.status(503).json({ error: 'Database not ready' });

    try {
        const body = req.body;
        const order_id = body.order_id || `ORD-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
        const now = mysqlNow();

        // ✅ Jika payment sudah PAID, set order_status ke SEARCHING
        let orderStatus = body.order_status || 'PENDING';
        if (body.payment_status === 'PAID' && orderStatus === 'PENDING') {
            orderStatus = 'SEARCHING';
            console.log(`✅ Payment already PAID, setting order_status to SEARCHING`);
        }

        const [dbResult] = await pool.execute(`
            INSERT INTO orders (
                order_id, order_status, order_date, order_note,
                service_type, service_name, service_description,
                origin_address, origin_lat, origin_lng,
                destination_address, destination_lat, destination_lng,
                distance_km, estimated_duration_min,
                base_price, service_fee, discount, total_price,
                payment_method, payment_status, partner_reff,
                mitra_id, mitra_name, mitra_phone,
                driver_id, driver_name, driver_phone, driver_photo, driver_address, driver_lat, driver_lng,
                customer_name, customer_phone,
                created_at, updated_at
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        `, [
            order_id,
            orderStatus,
            body.order_date || now,
            body.order_note || null,
            body.service_type || null,
            body.service_name || null,
            body.service_description || null,
            body.origin_address || null,
            body.origin_lat || null,
            body.origin_lng || null,
            body.destination_address || null,
            body.destination_lat || null,
            body.destination_lng || null,
            body.distance_km || null,
            body.estimated_duration_min || null,
            body.base_price || 0,
            body.service_fee || 0,
            body.discount || 0,
            body.total_price || 0,
            body.payment_method || null,
            body.payment_status || 'UNPAID',
            body.partner_reff || null,
            body.mitra_id || null,
            body.mitra_name || null,
            body.mitra_phone || null,
            body.driver_id || null,
            body.driver_name || null,
            body.driver_phone || null,
            body.driver_photo || null,
            body.driver_address || null,
            body.driver_lat || null,
            body.driver_lng || null,
            body.customer_name || null,
            body.customer_phone || null,
            now,
            now,
        ]);

        // ✅ Jika payment PAID, trigger pencarian driver
        if (body.payment_status === 'PAID') {
            console.log(`🎯 [ORDERS-CREATE] Payment PAID, triggering driver search for ${order_id}`);
            // Trigger driver search (bisa panggil endpoint atau emit event)
            triggerDriverSearch(order_id, body);
        }

        res.status(201).json({
            success: true,
            message: 'Order berhasil dibuat',
            order_id,
            order_status: orderStatus,
            insert_id: dbResult.insertId
        });

    } catch (err) {
        console.error('❌ [ORDERS-CREATE] Error:', err.message);
        res.status(500).json({ error: 'Gagal membuat order', detail: err.message });
    }
});

// ============================================================
// FUNGSI TRIGGER PENCARIAN DRIVER
// ============================================================
async function triggerDriverSearch(order_id, orderData) {
    console.log(`🔍 [DRIVER-SEARCH] Starting search for order: ${order_id}`);

    // Disini Anda bisa implementasi logika pencarian driver
    // Misalnya: kirim notifikasi ke semua driver aktif
    // Atau panggil endpoint /driver-confirmation

    // Contoh: Kirim notifikasi ke admin/driver terdekat
    try {
        const adminMessage = `🔍 *PENCARIAN DRIVER*
━━━━━━━━━━━━━━━━━━━━━
Order ID: ${order_id}
Customer: ${orderData.customer_name}
Total: ${formatRupiah(orderData.total_price)}
Jarak: ${orderData.distance_km} km

Sedang mencari driver terdekat...`;

        await sendWhatsAppFreeForm(CONFIG.adminWaNumber.replace('whatsapp:', ''), adminMessage);
    } catch (error) {
        console.error('Error triggering driver search:', error);
    }
}
// ============================================================
// ENDPOINT: GET /orders (list orders dengan filter)
// ============================================================
app.get('/orders', async (req, res) => {
    try {
        const { driver_id, mitra_id, status, limit = 50, offset = 0 } = req.query;

        console.log('📝 [ORDERS-LIST] Received query:', { driver_id, mitra_id, status, limit, offset });

        // Build WHERE clause
        const conditions = [];
        const values = [];

        if (driver_id && driver_id !== 'undefined' && driver_id !== 'null') {
            conditions.push('driver_id = ?');
            values.push(driver_id);
        }

        if (mitra_id && mitra_id !== 'undefined' && mitra_id !== 'null') {
            conditions.push('mitra_id = ?');
            values.push(mitra_id);
        }

        if (status && status !== 'undefined' && status !== 'null' && status !== 'ALL') {
            conditions.push('order_status = ?');
            values.push(status.toUpperCase());
        }

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

        // Parse pagination dengan aman
        let parsedLimit = parseInt(limit);
        let parsedOffset = parseInt(offset);

        if (isNaN(parsedLimit) || parsedLimit < 1) parsedLimit = 50;
        if (isNaN(parsedOffset) || parsedOffset < 0) parsedOffset = 0;

        // Batasi maksimal 1000 records
        parsedLimit = Math.min(parsedLimit, 1000);

        // Build query
        let query = `SELECT * FROM orders ${whereClause} ORDER BY created_at DESC LIMIT ${parsedLimit} OFFSET ${parsedOffset}`;

        console.log('📝 [ORDERS-LIST] Query:', query);
        console.log('📝 [ORDERS-LIST] Values:', values);

        // Execute query
        const [results] = await pool.execute(query, values);

        console.log(`✅ [ORDERS-LIST] Success: ${results.length} orders found`);

        res.json({
            success: true,
            count: results.length,
            data: results,
            pagination: {
                limit: parsedLimit,
                offset: parsedOffset
            }
        });

    } catch (err) {
        console.error('❌ [ORDERS-LIST] Error:', err.message);
        console.error('❌ [ORDERS-LIST] Stack:', err.stack);

        res.status(500).json({
            error: 'Gagal mengambil data orders',
            detail: err.message,
            stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
        });
    }
});

// ============================================================
// ENDPOINT: GET /orders/:order_id (detail order)
// ============================================================
app.get('/orders/:order_id', async (req, res) => {
    const { order_id } = req.params;

    try {
        const [rows] = await pool.execute('SELECT * FROM orders WHERE order_id = ?', [order_id]);

        if (!rows.length) {
            return res.status(404).json({ success: false, message: 'Order tidak ditemukan' });
        }

        res.json({ success: true, data: rows[0] });

    } catch (err) {
        console.error('❌ [ORDERS-DETAIL] Error:', err.message);
        res.status(500).json({ error: 'Gagal mengambil detail order', detail: err.message });
    }
});

// ============================================================
// ENDPOINT: PUT /orders/:order_id (update order)
// ============================================================
// ============================================================
// ENDPOINT: PUT /orders/:order_id (update order) - UPDATED
// ============================================================
app.put('/orders/:order_id', async (req, res) => {
    const { order_id } = req.params;
    const body = req.body;

    try {
        const allowedFields = [
            'order_status', 'order_note',
            'origin_address', 'origin_lat', 'origin_lng',
            'destination_address', 'destination_lat', 'destination_lng',
            'distance_km', 'estimated_duration_min',
            'base_price', 'service_fee', 'discount', 'total_price',
            'payment_method', 'payment_status', 'partner_reff',
            'mitra_id', 'mitra_name', 'mitra_phone',
            'driver_id', 'driver_name', 'driver_phone', 'driver_photo', 'driver_address', 'driver_lat', 'driver_lng',
            'customer_name', 'customer_phone',
        ];

        const setClauses = [];
        const values = [];

        for (const field of allowedFields) {
            if (body[field] !== undefined) {
                setClauses.push(`${field} = ?`);
                values.push(body[field]);
            }
        }

        if (!setClauses.length) {
            return res.status(400).json({ success: false, message: 'Tidak ada field valid untuk diupdate' });
        }

        setClauses.push('updated_at = ?');
        values.push(mysqlNow(), order_id);

        const [result] = await pool.execute(
            `UPDATE orders SET ${setClauses.join(', ')} WHERE order_id = ?`,
            values
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ success: false, message: 'Order tidak ditemukan' });
        }

        // ✅ Jika driver di-assign, update status order ke CONFIRMED
        if (body.driver_id && body.driver_name) {
            await pool.execute(
                `UPDATE orders SET order_status = 'CONFIRMED', updated_at = ? WHERE order_id = ?`,
                [mysqlNow(), order_id]
            );
            console.log(`✅ Driver ${body.driver_name} assigned to order ${order_id}, status updated to CONFIRMED`);

            // Kirim notifikasi ke customer
            const [orders] = await pool.execute('SELECT * FROM orders WHERE order_id = ?', [order_id]);
            if (orders.length > 0) {
                await sendDriverAssignedNotification(orders[0]);
            }
        }

        res.json({ success: true, message: 'Order berhasil diupdate', order_id });

    } catch (err) {
        console.error('❌ [ORDERS-UPDATE] Error:', err.message);
        res.status(500).json({ error: 'Gagal mengupdate order', detail: err.message });
    }
});

// ============================================================
// FUNGSI NOTIFIKASI DRIVER ASSIGNED
// ============================================================
async function sendDriverAssignedNotification(order) {
    console.log(`📧 [DRIVER-ASSIGNED] Sending notification for order ${order.order_id}`);

    const message = `🚗 *DRIVER TELAH DITUGASKAN!*
━━━━━━━━━━━━━━━━━━━━━
Halo *${order.customer_name}*,

Driver *${order.driver_name}* telah ditugaskan untuk pesanan Anda.

📋 Order ID: ${order.order_id}
💰 Total: ${formatRupiah(order.total_price)}

Driver akan segera menghubungi Anda.

Terima kasih! 🙏`;

    try {
        await sendWhatsAppFreeForm(order.customer_phone, message);
        console.log(`✅ Driver assigned notification sent to ${order.customer_phone}`);
    } catch (error) {
        console.error('Error sending notification:', error);
    }
}

// ============================================================
// ENDPOINT: POST /orders/:order_id/assign-driver
// ============================================================
app.post('/orders/:order_id/assign-driver', async (req, res) => {
    const { order_id } = req.params;
    const { driver_id, driver_name, driver_phone, driver_photo, driver_address, driver_lat, driver_lng } = req.body;

    if (!driver_id || !driver_name) {
        return res.status(400).json({ success: false, message: 'driver_id dan driver_name wajib diisi' });
    }

    try {
        const [result] = await pool.execute(`
            UPDATE orders SET 
                driver_id = ?,
                driver_name = ?,
                driver_phone = ?,
                driver_photo = ?,
                driver_address = ?,
                driver_lat = ?,
                driver_lng = ?,
                order_status = 'CONFIRMED',
                updated_at = ?
            WHERE order_id = ?
        `, [
            driver_id,
            driver_name,
            driver_phone || null,
            driver_photo || null,
            driver_address || null,
            driver_lat || null,
            driver_lng || null,
            mysqlNow(),
            order_id
        ]);

        if (result.affectedRows === 0) {
            return res.status(404).json({ success: false, message: 'Order tidak ditemukan' });
        }

        // Ambil data order yang sudah diupdate
        const [orders] = await pool.execute('SELECT * FROM orders WHERE order_id = ?', [order_id]);
        const order = orders[0];

        // Kirim notifikasi ke customer
        await sendDriverAssignedNotification(order);

        res.json({
            success: true,
            message: 'Driver berhasil ditugaskan',
            order_status: 'CONFIRMED',
            driver: { driver_id, driver_name, driver_phone }
        });

    } catch (error) {
        console.error('❌ Error assigning driver:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});
// ============================================================
// ENDPOINT: GET /drivers (SSE for drivers)
// ============================================================
app.get('/drivers', async (req, res) => {
    const HARDCODED_TOKEN = "eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiIsImp0aSI6IjEzODE1NmI0Y2U1NGQxYmY2ZWRkNjllYmU5NjYxYzI3MmIxMjY4NDY5NDUzZjdhMjBjOWM0MWQ1ODNmODAzZjQwOGQ4MzdiN2Y2OGVjYTIzIn0.eyJhdWQiOiIxIiwianRpIjoiMTM4MTU2YjRjZTU0ZDFiZjZlZGQ2OWViZTk2NjFjMjcyYjEyNjg0Njk0NTNmN2EyMGM5YzQxZDU4M2Y4MDNmNDA4ZDgzN2I3ZjY4ZWNhMjMiLCJpYXQiOjE3ODA0OTE1NDEsIm5iZiI6MTc4MDQ5MTU0MSwiZXhwIjoxODEyMDI3NTQxLCJzdWIiOiIyOTcxODQ0Iiwic2NvcGVzIjpbXX0.V3nZisKH-lmfEmf0iqyRmadupFf8nVL5VbpxyBZ_Y7baoA2Q5yoposdHjmokbZqLEZ-a9dL0S2nINPNE9zxdjfU7tmY1Awz24Ii7mOkaQL8dz2680SY5S2raqiWiLn7vYNinTKiA2juWvKMFVvFkfH1PnKQQ_L7nGBW3ReQ0kQg4AbqAj5z1XcfDtuZ9NPLB0QupNsdIkSBz-bliNR3aX9YjL9pzv6aszKSzRYQZni2FT0URQKvPk9B0MXTpFDzKqjURlvkFrN-jpoiV6LSzBlIBuyR5rTf3seU9vPgGDLkDLX9sm7QO8vK7TKBl40TQjbmHT9KE7pQAM-JsPw5QyeJkSpXXNcRnpm1i0Pq8lrJUeAHlyE6j2iIsLoZKtUrQAI2rAdYUjwGFoo6N26c9rbZIEeibNUdSPco68oYY_BqKYoK4kGmzGCkUV1HrZopDhcrNfhDYZEiZtNgkNAiKRpjPXblMIeN7tGjORn29DXqxspGio2DhhNIEex-Ih3a5yaW39EgDVgWS2eDBTV0A6u3ZAJkxPctNkVkxehuxSCYVjnAv6dVjKcypzJQLmMXT77VAQ7hOrrd-_iO5cliCtkyoPjkVDYxEZ9bjAaFwkb7xVKdULFSwAyYzvKYas_-tG3mEvhcUynPRGVcJutfHULGYfYxJWkXdQovk7H-l7uo";

    const { bearer_token, max_pages, page, unique_id, driver_status, detail = 'true' } = req.query;
    const finalToken = bearer_token || HARDCODED_TOKEN;

    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*'
    });

    const sendEvent = (eventName, data) => {
        res.write(`event: ${eventName}\n`);
        res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    const DEFAULT_UNIQUE_ID = unique_id || '03421121304617f701ba3b374.23310242';
    const DEFAULT_DRIVER_STATUS = driver_status || '2';
    const REPORT_URL = 'https://app.jagel.id/api/driver/report';
    const BATCH_SIZE = 3;

    async function fetchDriverDetail(view_uid) {
        const detailUrl = `https://app.jagel.id/api/users/${view_uid}?driver=1`;
        try {
            const response = await callJagelAppApi(detailUrl, finalToken, 'GET');
            return response.data;
        } catch (err) {
            console.warn(`⚠️ [DETAIL] Failed for ${view_uid}: ${err.message}`);
            return null;
        }
    }

    async function fetchDriversReport(pageNum = 1) {
        const payload = {
            unique_id: DEFAULT_UNIQUE_ID,
            paginate: 10,
            driver_status: parseInt(DEFAULT_DRIVER_STATUS),
            page: pageNum
        };

        try {
            const response = await callJagelAppApi(REPORT_URL, finalToken, 'POST', payload);
            return response.data;
        } catch (err) {
            console.error(`❌ [REPORT] Error on page ${pageNum}:`, err.message);
            return null;
        }
    }

    sendEvent('start', { message: 'Memulai pengambilan data driver' });

    if (page) {
        const reportData = await fetchDriversReport(parseInt(page));
        if (!reportData || !reportData.success) {
            sendEvent('error', { message: 'Gagal mengambil data report' });
            sendEvent('end', { message: 'Proses gagal' });
            return res.end();
        }

        const driversList = reportData.data?.drivers?.data || [];

        if (driversList.length > 0 && detail === 'true') {
            for (let i = 0; i < driversList.length; i++) {
                const driver = driversList[i];
                const detailData = await fetchDriverDetail(driver.view_uid);
                sendEvent('driver_update', { driver: { ...driver, detail: detailData } });
                await new Promise(r => setTimeout(r, 100));
            }
        } else if (driversList.length > 0) {
            sendEvent('batch', { drivers: driversList });
        }

        sendEvent('end', { success: true, total_drivers: driversList.length });
        return res.end();
    }

    const limit = Math.min(parseInt(max_pages) || 100, 200);
    let currentPage = 1;
    let lastPage = null;
    let processedDrivers = 0;

    while (currentPage <= limit) {
        const reportData = await fetchDriversReport(currentPage);
        if (!reportData || !reportData.success) break;

        const driversData = reportData.data?.drivers;
        if (!driversData) break;

        const driversList = driversData.data || [];

        if (lastPage === null) {
            lastPage = driversData.last_page || 0;
            sendEvent('meta', { total_pages: lastPage, total_drivers: driversData.total || 0 });
        }

        if (driversList.length === 0) break;

        if (detail === 'true') {
            for (let i = 0; i < driversList.length; i++) {
                const driver = driversList[i];
                const detailData = await fetchDriverDetail(driver.view_uid);
                processedDrivers++;
                sendEvent('driver_update', { count: processedDrivers, driver: { ...driver, detail: detailData } });
                await new Promise(r => setTimeout(r, 100));
            }
        } else {
            processedDrivers += driversList.length;
            sendEvent('batch', { page: currentPage, drivers: driversList });
        }

        if (currentPage >= lastPage) break;
        currentPage++;
        await new Promise(r => setTimeout(r, 150));
    }

    sendEvent('complete', { total_drivers: processedDrivers, total_pages: lastPage });
    sendEvent('end', { success: true });
    res.end();
});

// ============================================================
// ENDPOINT: POST /driver-confirmation (USING TEMPLATE)
// ============================================================
app.post('/driver-confirmation', async (req, res) => {
    const { order_id, driver_id, driver_name, driver_phone, customer_name, total_amount, jumlah_toko } = req.body;
    const normalizedDriverPhone = normalizePhoneNumber(driver_phone);

    console.log(`\n📋 [DRIVER-CONFIRMATION] Order: ${order_id}, Driver: ${driver_name}`);

    // ✅ Simpan konfirmasi ke memory
    driverConfirmations.set(order_id, {
        driver_id, driver_name, driver_phone: normalizedDriverPhone,
        customer_name, total_amount, jumlah_toko,
        status: 'pending', timestamp: Date.now(), expiresAt: Date.now() + (3 * 60 * 1000)
    });

    // ✅ UPDATE: Assign driver ke order yang sudah ada (jika order sudah tersimpan)
    try {
        const [result] = await pool.execute(`
            UPDATE orders SET 
                driver_id = ?, driver_name = ?, driver_phone = ?,
                updated_at = ?
            WHERE order_id = ? AND driver_id IS NULL
        `, [driver_id, driver_name, normalizedDriverPhone, mysqlNow(), order_id]);

        if (result.affectedRows > 0) {
            console.log(`✅ Driver pre-assigned to order ${order_id} in database`);
        } else {
            console.log(`⚠️ Order ${order_id} not yet in database, driver will be assigned when order is created`);
        }
    } catch (error) {
        console.log(`⚠️ Could not pre-assign driver: ${error.message}`);
    }

    // Kirim template WhatsApp ke driver
    const variables = { "1": driver_name, "2": customer_name, "3": total_amount, "4": jumlah_toko.toString() };
    const whatsappResult = await sendWhatsAppTemplate(driver_phone, CONFIG.templateDriverConfirmation, variables);

    res.json({ success: whatsappResult.success, order_id, ...whatsappResult });
});
// ============================================================
// ENDPOINT: POST /send-order-details (USING TEMPLATE)
// ============================================================
app.post('/send-order-details', async (req, res) => {
    const { order_id, driver_phone, driver_name, customer_name, customer_phone, stores_detail, subtotal, total_ongkir, total, order_note } = req.body;

    console.log(`\n📦 [SEND-ORDER-DETAILS] Order: ${order_id}`);

    // Send to Driver using template
    const driverVariables = {
        "1": driver_name,
        "2": customer_name,
        "3": customer_phone,
        "4": order_id,
        "5": stores_detail || 'Detail pesanan terlampir',
        "6": total
    };

    const driverResult = await sendWhatsAppTemplate(
        driver_phone,
        CONFIG.templateDriverOrderAccepted,
        driverVariables
    );

    // Send to Customer using template
    const customerVariables = {
        "1": customer_name,
        "2": driver_name,
        "3": driver_phone,
        "4": order_id,
        "5": stores_detail || 'Detail pesanan terlampir',
        "6": total
    };

    const customerResult = await sendWhatsAppTemplate(
        customer_phone,
        CONFIG.templateCustomerOrderConfirmed,
        customerVariables
    );

    res.json({
        success: driverResult.success && customerResult.success,
        driver: driverResult,
        customer: customerResult
    });
});

// ============================================================
// ENDPOINT: POST /send-driver-rejected (USING TEMPLATE)
// ============================================================
app.post('/send-driver-rejected', async (req, res) => {
    const { customer_phone, customer_name } = req.body;

    console.log(`\n📋 [SEND-DRIVER-REJECTED] To: ${customer_name} (${customer_phone})`);

    const variables = {
        "1": customer_name
    };

    const result = await sendWhatsAppTemplate(
        customer_phone,
        CONFIG.templateDriverRejected,
        variables
    );

    res.json({ success: result.success, ...result });
});

// ============================================================
// ENDPOINT: POST /send-no-driver (USING TEMPLATE)
// ============================================================
app.post('/send-no-driver', async (req, res) => {
    const { customer_phone, customer_name, total_amount } = req.body;

    console.log(`\n📋 [SEND-NO-DRIVER] To: ${customer_name} (${customer_phone})`);

    const variables = {
        "1": customer_name,
        "2": total_amount,
        "3": CONFIG.csNumber
    };

    const result = await sendWhatsAppTemplate(
        customer_phone,
        CONFIG.templateNoDriverAvailable,
        variables
    );

    res.json({ success: result.success, ...result });
});

// ============================================================
// ENDPOINT: GET /driver/accept/:orderId
// ============================================================
app.get('/driver/accept/:orderId', async (req, res) => {
    const { orderId } = req.params;
    const confirmation = driverConfirmations.get(orderId);

    console.log(`\n📋 [DRIVER-ACCEPT] Order: ${orderId}, Status: ${confirmation?.status || 'not found'}`);

    if (confirmation && confirmation.status === 'pending' && Date.now() < confirmation.expiresAt) {
        confirmation.status = 'accepted';
        confirmation.acceptedAt = Date.now();
        driverConfirmations.set(orderId, confirmation);

        res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Pesanan Diterima</title>
                <style>
                    body {
                        display: flex;
                        justify-content: center;
                        align-items: center;
                        height: 100vh;
                        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                        background: linear-gradient(135deg, #10b981 0%, #059669 100%);
                        margin: 0;
                        padding: 20px;
                    }
                    .card {
                        background: white;
                        border-radius: 20px;
                        padding: 40px;
                        text-align: center;
                        max-width: 400px;
                        box-shadow: 0 20px 60px rgba(0,0,0,0.3);
                    }
                    .icon { font-size: 80px; margin-bottom: 20px; }
                    h2 { color: #10b981; margin-bottom: 10px; }
                    p { color: #666; margin-bottom: 20px; }
                    .order-id {
                        background: #f3f4f6;
                        padding: 10px;
                        border-radius: 10px;
                        font-family: monospace;
                        margin: 20px 0;
                    }
                </style>
            </head>
            <body>
                <div class="card">
                    <div class="icon">✅</div>
                    <h2>Pesanan Diterima!</h2>
                    <p>Terima kasih telah menerima pesanan.</p>
                    <div class="order-id">Order ID: ${orderId}</div>
                    <p>Detail pesanan akan dikirimkan segera ke WhatsApp Anda.</p>
                    <small>Halaman ini akan ditutup dalam 5 detik...</small>
                </div>
                <script>setTimeout(() => window.close(), 5000);</script>
            </body>
            </html>
        `);
    } else {
        res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <title>Konfirmasi Kadaluwarsa</title>
                <style>
                    body {
                        display: flex;
                        justify-content: center;
                        align-items: center;
                        height: 100vh;
                        font-family: sans-serif;
                        background: #fef2f2;
                        margin: 0;
                    }
                    .card {
                        background: white;
                        border-radius: 20px;
                        padding: 40px;
                        text-align: center;
                        max-width: 400px;
                    }
                    .icon { font-size: 80px; }
                    h2 { color: #ef4444; }
                </style>
            </head>
            <body>
                <div class="card">
                    <div class="icon">⏰</div>
                    <h2>Konfirmasi Kadaluwarsa</h2>
                    <p>Pesanan ini sudah tidak tersedia atau sudah kadaluwarsa.</p>
                </div>
            </body>
            </html>
        `);
    }
});

// ============================================================
// ENDPOINT: GET /driver/reject/:orderId
// ============================================================
app.get('/driver/reject/:orderId', async (req, res) => {
    const { orderId } = req.params;
    const confirmation = driverConfirmations.get(orderId);

    console.log(`\n📋 [DRIVER-REJECT] Order: ${orderId}, Status: ${confirmation?.status || 'not found'}`);

    if (confirmation && confirmation.status === 'pending' && Date.now() < confirmation.expiresAt) {
        confirmation.status = 'rejected';
        confirmation.rejectedAt = Date.now();
        driverConfirmations.set(orderId, confirmation);

        res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <title>Pesanan Ditolak</title>
                <style>
                    body {
                        display: flex;
                        justify-content: center;
                        align-items: center;
                        height: 100vh;
                        font-family: sans-serif;
                        background: #fef2f2;
                        margin: 0;
                    }
                    .card {
                        background: white;
                        border-radius: 20px;
                        padding: 40px;
                        text-align: center;
                        max-width: 400px;
                    }
                    .icon { font-size: 80px; }
                    h2 { color: #ef4444; margin-bottom: 10px; }
                    p { color: #666; }
                </style>
            </head>
            <body>
                <div class="card">
                    <div class="icon">❌</div>
                    <h2>Pesanan Ditolak</h2>
                    <p>Terima kasih sudah memberitahu.</p>
                    <p>Pesanan akan dialihkan ke driver lain.</p>
                    <small>Halaman ini akan ditutup...</small>
                </div>
                <script>setTimeout(() => window.close(), 3000);</script>
            </body>
            </html>
        `);
    } else {
        res.send(`
            <!DOCTYPE html>
            <html>
            <body style="display:flex;justify-content:center;align-items:center;height:100vh;">
                <div style="text-align:center;">
                    <div style="font-size:64px;">⏰</div>
                    <h2>Konfirmasi Kadaluwarsa</h2>
                    <p>Pesanan ini sudah tidak tersedia.</p>
                </div>
            </body>
            </html>
        `);
    }
});


// ============================================================
app.post('/webhook/whatsapp', express.urlencoded({ extended: true }), async (req, res) => {
    console.log('\n📨 [WEBHOOK] ============================================');
    console.log('📨 [WEBHOOK] Content-Type:', req.headers['content-type']);
    console.log('📨 [WEBHOOK] Body:', JSON.stringify(req.body, null, 2));

    const messageBody = req.body.Body || req.body.body;
    const fromNumber = req.body.From || req.body.from;

    if (!messageBody || !fromNumber) {
        console.error('❌ Missing required fields');
        return res.sendStatus(400);
    }

    const rawDriverPhone = fromNumber.replace('whatsapp:', '');
    const driverPhone = normalizePhoneNumber(rawDriverPhone);
    const message = messageBody.trim().toUpperCase();

    console.log(`📱 Raw from: ${rawDriverPhone} -> Normalized: ${driverPhone}`);
    console.log(`📱 Message: ${message}`);

    // Cari order pending
    let foundOrderId = null;
    let foundConfirmation = null;

    for (const [orderId, confirmation] of driverConfirmations) {
        if (confirmation.driver_phone === driverPhone && confirmation.status === 'pending') {
            foundOrderId = orderId;
            foundConfirmation = confirmation;
            break;
        }
    }

    if (foundOrderId && foundConfirmation) {
        console.log(`✅ Found pending order ${foundOrderId}`);

        // CEK UNTUK ACCEPT - Masukkan "ACCEPT" karena itu yang dikirim Twilio!
        if (message === 'ACCEPT' || message === 'TERIMA' || message === 'SETUJU' || message === 'YES' || message === 'YA') {
            foundConfirmation.status = 'accepted';
            foundConfirmation.acceptedAt = Date.now();
            driverConfirmations.set(foundOrderId, foundConfirmation);
            console.log(`✅ Driver ACCEPTED order ${foundOrderId}`);

            // Kirim respon ke driver
            await sendWhatsAppFreeForm(rawDriverPhone, '✅ Terima kasih! Detail pesanan akan kami kirimkan segera.');

            // Kirim detail order
            await sendOrderDetailsToDriver(foundOrderId, foundConfirmation);
            await notifyCustomerOrderAccepted(foundOrderId, foundConfirmation);

        }
        // CEK UNTUK REJECT - Masukkan "REJECT" karena itu yang dikirim Twilio!
        else if (message === 'REJECT' || message === 'TOLAK' || message === 'NO') {
            foundConfirmation.status = 'rejected';
            foundConfirmation.rejectedAt = Date.now();
            driverConfirmations.set(foundOrderId, foundConfirmation);
            console.log(`❌ Driver REJECTED order ${foundOrderId}`);

            await sendWhatsAppFreeForm(rawDriverPhone, '❌ Pesanan ditolak. Terima kasih.');

            await sendWhatsAppTemplate(
                foundConfirmation.customer_phone,
                CONFIG.templateDriverRejected,
                { "1": foundConfirmation.customer_name }
            );
        } else {
            console.log(`⚠️ Unknown message: ${message}`);
        }
    } else {
        console.log(`⚠️ No pending order found for driver ${driverPhone}`);
        // Debug: tampilkan semua pending order
        for (const [orderId, confirmation] of driverConfirmations) {
            if (confirmation.status === 'pending') {
                console.log(`   Pending: ${orderId} -> driver: ${confirmation.driver_phone}`);
            }
        }
    }

    res.sendStatus(200);
});

// ============================================================
// FUNGSI KIRIM DETAIL ORDER KE DRIVER (FIXED - DENGAN AUTO CREATE)
// ============================================================
async function sendOrderDetailsToDriver(orderId, confirmation) {
    console.log(`📦 [SEND-ORDER-DETAILS] Order: ${orderId}`);

    try {
        // Cari order di database
        let [orders] = await pool.execute('SELECT * FROM orders WHERE order_id = ?', [orderId]);

        if (orders.length === 0) {
            console.log(`⚠️ Order ${orderId} not found, cannot send details yet`);
            console.log(`   Driver ${confirmation.driver_name} will get details when order is created`);
            return;
        }

        const order = orders[0];

        // ✅ Update driver jika belum ada
        if (!order.driver_id) {
            await pool.execute(`
                UPDATE orders SET 
                    driver_id = ?, driver_name = ?, driver_phone = ?,
                    order_status = 'CONFIRMED', updated_at = ?
                WHERE order_id = ?
            `, [confirmation.driver_id, confirmation.driver_name, confirmation.driver_phone, mysqlNow(), orderId]);
            console.log(`✅ Driver ${confirmation.driver_name} assigned to order ${orderId}`);
        }

        // Kirim detail ke driver
        await sendWhatsAppTemplate(confirmation.driver_phone, CONFIG.templateDriverOrderAccepted, {
            "1": confirmation.driver_name,
            "2": order.customer_name,
            "3": order.customer_phone,
            "4": orderId,
            "5": "Detail pesanan: " + (order.order_note || '-'),
            "6": formatRupiah(order.total_price)
        });

        // Notifikasi ke customer
        const message = `🚗 *DRIVER TELAH DITUGASKAN!*
━━━━━━━━━━━━━━━━━━━━━
Halo *${order.customer_name}*,

Driver *${confirmation.driver_name}* telah ditugaskan!

Order ID: ${order.order_id}
Total: ${formatRupiah(order.total_price)}

Driver akan segera menghubungi Anda. 🙏`;

        await sendWhatsAppFreeForm(order.customer_phone, message);
        console.log(`✅ Customer notification sent`);

    } catch (error) {
        console.error(`❌ Error:`, error.message);
    }
}
// ============================================================
// FUNGSI NOTIFIKASI KE CUSTOMER BAHWA DRIVER SUDAH DIASSIGN
// ============================================================
async function sendCustomerDriverAssignedNotification(order, confirmation) {
    console.log(`📧 [CUSTOMER-NOTIFICATION] Notifying customer for order ${order.order_id}`);

    try {
        const customerPhone = order.customer_phone || confirmation.customer_phone;
        if (!customerPhone) {
            console.error('❌ No customer phone found');
            return;
        }

        const message = `🚗 *DRIVER TELAH DITUGASKAN!*
━━━━━━━━━━━━━━━━━━━━━
Halo *${order.customer_name || confirmation.customer_name}*,

Pesanan Anda telah dikonfirmasi oleh driver!

📋 *Detail Pesanan:*
Order ID: ${order.order_id}
Driver: ${confirmation.driver_name}
Total: ${formatRupiah(order.total_price || confirmation.total_amount)}

Driver akan segera menghubungi Anda via WhatsApp.

Terima kasih telah menggunakan layanan kami! 🙏`;

        const result = await sendWhatsAppFreeForm(customerPhone, message);
        if (result.success) {
            console.log(`✅ Customer notification sent to ${customerPhone}`);
        } else {
            console.error(`❌ Failed to send customer notification: ${result.error}`);
        }
    } catch (error) {
        console.error('Error sending customer notification:', error.message);
    }
}
// ============================================================
// FUNGSI NOTIFIKASI DRIVER ASSIGNED KE CUSTOMER
// ============================================================
async function sendDriverAssignedNotification(order, confirmation) {
    console.log(`📧 [DRIVER-ASSIGNED] Notifying customer for order ${order.order_id}`);

    const message = `🚗 *DRIVER TELAH DITUGASKAN!*
━━━━━━━━━━━━━━━━━━━━━
Halo *${order.customer_name}*,

Pesanan Anda telah dikonfirmasi oleh driver!

📋 *Detail Pesanan:*
Order ID: ${order.order_id}
Driver: ${confirmation.driver_name}
Total: ${formatRupiah(order.total_price)}

Driver akan segera menghubungi Anda via WhatsApp.

Terima kasih telah menggunakan layanan kami! 🙏`;

    try {
        await sendWhatsAppFreeForm(order.customer_phone, message);
        console.log(`✅ Customer notification sent to ${order.customer_phone}`);
    } catch (error) {
        console.error('Error sending customer notification:', error.message);
    }
}

// ============================================================
// FUNGSI NOTIFIKASI KE CUSTOMER (UPDATED)
// ============================================================
async function notifyCustomerOrderAccepted(orderId, confirmation) {
    console.log(`📧 [NOTIFY-CUSTOMER] Order: ${orderId}`);

    try {
        const [orders] = await pool.execute(
            'SELECT * FROM orders WHERE order_id = ?',
            [orderId]
        );

        if (orders.length === 0) {
            console.log(`⚠️ Order ${orderId} not found in database yet, skipping customer notification`);
            return;
        }

        const order = orders[0];

        // Pastikan status sudah CONFIRMED
        if (order.order_status !== 'CONFIRMED') {
            await pool.execute(`
                UPDATE orders SET 
                    order_status = 'CONFIRMED',
                    driver_id = ?,
                    driver_name = ?,
                    driver_phone = ?,
                    updated_at = ?
                WHERE order_id = ?
            `, [
                confirmation.driver_id,
                confirmation.driver_name,
                confirmation.driver_phone,
                mysqlNow(),
                orderId
            ]);
            console.log(`✅ Order ${orderId} status updated to CONFIRMED`);
        }

        const variables = {
            "1": order.customer_name,
            "2": confirmation.driver_name,
            "3": confirmation.driver_phone,
            "4": orderId,
            "5": "Pesanan Anda telah dikonfirmasi oleh driver dan sedang diproses",
            "6": formatRupiah(order.total_price)
        };

        await sendWhatsAppTemplate(
            order.customer_phone,
            CONFIG.templateCustomerOrderConfirmed,
            variables
        );

        console.log(`✅ Customer notification sent to ${order.customer_phone}`);

    } catch (error) {
        console.error(`❌ Error sending customer notification:`, error.message);
    }
}

// Endpoint untuk fix order yang sudah diaccept
app.post('/fix-accepted-orders', async (req, res) => {
    console.log('🔧 Fixing accepted orders...');

    try {
        // Cari semua order yang memiliki driver confirmation di memory
        const fixedOrders = [];

        for (const [orderId, confirmation] of driverConfirmations) {
            if (confirmation.status === 'accepted') {
                // Update database
                const [result] = await pool.execute(`
                    UPDATE orders SET 
                        driver_id = ?,
                        driver_name = ?,
                        driver_phone = ?,
                        order_status = 'CONFIRMED',
                        updated_at = ?
                    WHERE order_id = ? AND order_status != 'CONFIRMED'
                `, [
                    confirmation.driver_id,
                    confirmation.driver_name,
                    confirmation.driver_phone,
                    mysqlNow(),
                    orderId
                ]);

                if (result.affectedRows > 0) {
                    fixedOrders.push(orderId);
                    console.log(`✅ Fixed order ${orderId}`);
                }
            }
        }

        res.json({
            success: true,
            message: `Fixed ${fixedOrders.length} orders`,
            fixed_orders: fixedOrders
        });
    } catch (error) {
        console.error('Error fixing orders:', error);
        res.status(500).json({ error: error.message });
    }
});
// ============================================================
// ENDPOINT: GET /check-confirmation/:orderId
// ============================================================
app.get('/check-confirmation/:orderId', async (req, res) => {
    const { orderId } = req.params;
    const confirmation = driverConfirmations.get(orderId);

    console.log(`\n📋 [CHECK-CONFIRMATION] Order: ${orderId}, Status: ${confirmation?.status || 'not found'}`);

    if (confirmation) {
        if (confirmation.status === 'pending' && Date.now() > confirmation.expiresAt) {
            confirmation.status = 'timeout';
            driverConfirmations.set(orderId, confirmation);
            console.log(`⏰ Order ${orderId} timed out`);
        }
        res.json({
            status: confirmation.status,
            driver_id: confirmation.driver_id,
            driver_name: confirmation.driver_name,
            driver_phone: confirmation.driver_phone
        });
    } else {
        res.json({ status: 'not_found' });
    }
});

// ============================================================
// ENDPOINT: POST /send-whatsapp (general - FREE FORM ONLY FOR REPLIES)
// ============================================================
app.post('/send-whatsapp', async (req, res) => {
    const { to, message, use_template, template_sid, variables } = req.body;

    console.log(`\n📋 [SEND-WHATSAPP] To: ${to}, use_template: ${use_template}`);

    let result;
    if (use_template && template_sid) {
        result = await sendWhatsAppTemplate(to, template_sid, variables || {});
    } else {
        result = await sendWhatsAppFreeForm(to, message);
    }

    res.json(result);
});

// ============================================================
// ENDPOINT: GET /health
// ============================================================
app.get('/health', (req, res) => {
    console.log(`\n💚 [HEALTH] Health check at ${new Date().toISOString()}`);

    res.json({
        status: 'OK',
        timestamp: new Date().toISOString(),
        database_ready: dbReady,
        uptime: process.uptime(),
        twilio_configured: !!(CONFIG.twilioSid && CONFIG.twilioAuth),
        twilio_client_ready: !!twilioClient,
        templates: {
            driver_confirmation: CONFIG.templateDriverConfirmation,
            driver_order_accepted: CONFIG.templateDriverOrderAccepted,
            customer_order_confirmed: CONFIG.templateCustomerOrderConfirmed,
            driver_rejected: CONFIG.templateDriverRejected,
            no_driver_available: CONFIG.templateNoDriverAvailable
        }
    });
});

// ============================================================
// ENDPOINT: GET /debug/driver-confirmations (lihat semua pending)
// ============================================================
app.get('/debug/driver-confirmations', async (req, res) => {
    const confirmations = [];
    for (const [orderId, conf] of driverConfirmations) {
        confirmations.push({
            order_id: orderId,
            status: conf.status,
            driver_name: conf.driver_name,
            driver_phone: conf.driver_phone,
            customer_name: conf.customer_name,
            customer_phone: conf.customer_phone,
            total_amount: conf.total_amount,
            timestamp: conf.timestamp,
            expiresAt: conf.expiresAt
        });
    }

    res.json({
        total_pending: driverConfirmations.size,
        confirmations: confirmations
    });
});

// ============================================================
// ENDPOINT: POST /fix-all-missing-orders
// ============================================================
app.post('/fix-all-missing-orders', async (req, res) => {
    console.log('🔧 Fixing all missing orders from driver confirmations...');

    const fixedOrders = [];
    const errors = [];

    for (const [orderId, confirmation] of driverConfirmations) {
        if (confirmation.status === 'accepted') {
            try {
                // Cek apakah order ada
                const [existing] = await pool.execute(
                    'SELECT order_id, driver_id FROM orders WHERE order_id = ?',
                    [orderId]
                );

                if (existing.length === 0 || !existing[0].driver_id) {
                    const now = mysqlNow();
                    let parsedTotal = 21000;
                    if (confirmation.total_amount) {
                        parsedTotal = parseInt(confirmation.total_amount.replace(/\D/g, '')) || 21000;
                    }

                    await pool.execute(`
                        INSERT INTO orders (
                            order_id, order_status, order_date,
                            customer_name, customer_phone, total_price, payment_status,
                            driver_id, driver_name, driver_phone,
                            created_at, updated_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        ON DUPLICATE KEY UPDATE
                            driver_id = VALUES(driver_id),
                            driver_name = VALUES(driver_name),
                            driver_phone = VALUES(driver_phone),
                            order_status = 'CONFIRMED',
                            updated_at = VALUES(updated_at)
                    `, [
                        orderId,
                        'CONFIRMED',
                        now,
                        confirmation.customer_name,
                        confirmation.customer_phone || '082323907426',
                        parsedTotal,
                        'PAID',
                        confirmation.driver_id,
                        confirmation.driver_name,
                        confirmation.driver_phone,
                        now,
                        now
                    ]);

                    fixedOrders.push(orderId);
                    console.log(`✅ Fixed missing order: ${orderId}`);
                }
            } catch (error) {
                errors.push({ orderId, error: error.message });
                console.error(`❌ Error fixing order ${orderId}:`, error.message);
            }
        }
    }

    res.json({
        success: true,
        fixed_count: fixedOrders.length,
        fixed_orders: fixedOrders,
        errors: errors
    });
});

// ============================================================
// START SERVER
// ============================================================
const PORT = CONFIG.port;
app.listen(PORT, () => {
    console.log('\n========================================');
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📍 URL: http://localhost:${PORT}`);
    console.log(`📁 Log: ${LOG_DIR}`);
    console.log('');
    console.log('📌 Endpoints:');
    console.log(`   GET  /health`);
    console.log(`   GET  /test-twilio`);
    console.log(`   GET  /test-twilio?send=true&to=628123456789`);
    console.log(`   POST /adjust.php`);
    console.log(`   POST /create-va`);
    console.log(`   POST /create-qris`);
    console.log(`   POST /callback`);
    console.log(`   POST /add-balance`);
    console.log(`   GET  /download-qr/:partner_reff`);
    console.log(`   GET  /check-status/:partner_reff`);
    console.log(`   POST /orders`);
    console.log(`   GET  /orders`);
    console.log(`   GET  /orders/:order_id`);
    console.log(`   PUT  /orders/:order_id`);
    console.log(`   GET  /drivers?bearer_token=xxx`);
    console.log(`   POST /driver-confirmation`);
    console.log(`   POST /send-order-details`);
    console.log(`   POST /send-driver-rejected`);
    console.log(`   POST /send-no-driver`);
    console.log(`   GET  /driver/accept/:orderId`);
    console.log(`   GET  /driver/reject/:orderId`);
    console.log(`   POST /webhook/whatsapp`);
    console.log(`   GET  /check-confirmation/:orderId`);
    console.log(`   POST /send-whatsapp`);
    console.log('');
    console.log('📱 Twilio Templates:');
    console.log(`   Driver Confirmation (QR): ${CONFIG.templateDriverConfirmation}`);
    console.log(`   Driver Order Accepted: ${CONFIG.templateDriverOrderAccepted}`);
    console.log(`   Customer Order Confirmed: ${CONFIG.templateCustomerOrderConfirmed}`);
    console.log(`   Driver Rejected: ${CONFIG.templateDriverRejected}`);
    console.log(`   No Driver Available: ${CONFIG.templateNoDriverAvailable}`);
    console.log('========================================\n');
});