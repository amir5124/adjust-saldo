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
// TWILIO INITIALIZATION
// ============================================================
let twilioClient = null;

function initTwilio() {
    console.log('\n🔧 [TWILIO] Initializing...');
    console.log(`   TWILIO_ACCOUNT_SID: ${CONFIG.twilioSid ? '✅ SET' : '❌ MISSING'}`);
    console.log(`   TWILIO_AUTH_TOKEN: ${CONFIG.twilioAuth ? '✅ SET' : '❌ MISSING'}`);

    if (!CONFIG.twilioSid || !CONFIG.twilioAuth) {
        console.error('\n❌ TWILIO CREDENTIALS MISSING!');
        return null;
    }

    try {
        twilioClient = twilio(CONFIG.twilioSid, CONFIG.twilioAuth);
        console.log('✅ Twilio client initialized successfully!');
        return twilioClient;
    } catch (error) {
        console.error('❌ Failed to initialize Twilio client:', error.message);
        return null;
    }
}

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
        const [rows] = await connection.query('SELECT VERSION() as version, NOW() as now, DATABASE() as db');
        console.log('✅ DATABASE CONNECTED!');
        console.log(`   MySQL Version: ${rows[0].version}`);
        console.log(`   Database: ${rows[0].db}`);
        connection.release();
        return true;
    } catch (err) {
        console.error('❌ DATABASE CONNECTION FAILED!');
        console.error(`   Error: ${err.message}`);
        return false;
    }
}

let dbReady = false;
testDatabaseConnection().then(result => {
    dbReady = result;
    if (!dbReady) console.error('\n⚠️ WARNING: Database not ready!');
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

function normalizePhoneNumber(phoneNumber) {
    if (!phoneNumber) return null;
    let cleaned = phoneNumber.toString().replace(/\D/g, '');
    if (cleaned.startsWith('0')) {
        cleaned = '62' + cleaned.substring(1);
    }
    if (!cleaned.startsWith('62')) {
        cleaned = '62' + cleaned;
    }
    return cleaned;
}

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
    return response;
}

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
        const response = await axios(config);
        return response;
    } catch (error) {
        if (error.response) {
            return { data: { success: false, message: `API Error: ${error.response.status}` } };
        }
        return { data: { success: false, message: `Error: ${error.message}` } };
    }
}

// ============================================================
// FUNGSI ADD BALANCE
// ============================================================
async function addBalance(amount, customer_name, methodCode, serialnumber) {
    const originalAmount = parseInt(amount);
    let admin = 4000;
    if (methodCode === 'QRIS') {
        admin = Math.round(originalAmount * 0.008);
    }
    const netAmount = originalAmount - admin;
    const username = 'amir';

    const note = `Pesanan dari ${customer_name} || Rp ${netAmount.toLocaleString('id-ID')} (admin ${admin.toLocaleString('id-ID')}) || ${methodCode === 'QRIS' ? 'QRIS' : 'VA'} || Reff: ${serialnumber}`;

    console.log(`💰 [ADD-BALANCE] ${customer_name} -> ${username} | Amount: ${netAmount}`);

    try {
        const response = await axios.post(`${CONFIG.jagelBaseUrl}/balance/adjust`, {
            action: 'adjust_balance',
            type: 'username',
            value: username,
            amount: netAmount,
            note: note,
            apikey: CONFIG.jagelApiKey
        }, { headers: { 'Content-Type': 'application/json' }, timeout: 30000 });
        return { success: true, data: response.data };
    } catch (error) {
        console.error('❌ Add balance failed:', error.message);
        throw error;
    }
}

// ============================================================
// TWILIO HELPER FUNCTIONS
// ============================================================
function formatWhatsAppNumber(phoneNumber) {
    if (!phoneNumber) return null;
    let cleaned = phoneNumber.toString().replace(/\D/g, '');
    if (cleaned.length < 10) return null;
    if (!cleaned.startsWith('62')) {
        if (cleaned.startsWith('0')) {
            cleaned = '62' + cleaned.substring(1);
        } else {
            cleaned = '62' + cleaned;
        }
    }
    return `whatsapp:${cleaned}`;
}

async function sendWhatsAppTemplate(to, templateSid, variables) {
    if (!twilioClient) return { success: false, error: 'Twilio client not initialized' };
    const whatsappTo = formatWhatsAppNumber(to);
    if (!whatsappTo) return { success: false, error: 'Invalid phone number' };
    if (!templateSid || !templateSid.startsWith('HX')) return { success: false, error: 'Invalid template SID' };

    try {
        const result = await twilioClient.messages.create({
            from: CONFIG.twilioWaNumber,
            to: whatsappTo,
            contentSid: templateSid,
            contentVariables: JSON.stringify(variables)
        });
        return { success: true, sid: result.sid, status: result.status };
    } catch (error) {
        console.error('❌ Twilio template error:', error.message);
        return { success: false, error: error.message };
    }
}

async function sendWhatsAppFreeForm(to, message) {
    if (!twilioClient) return { success: false, error: 'Twilio client not initialized' };
    const whatsappTo = formatWhatsAppNumber(to);
    if (!whatsappTo) return { success: false, error: 'Invalid phone number' };

    try {
        const result = await twilioClient.messages.create({
            from: CONFIG.twilioWaNumber,
            to: whatsappTo,
            body: message
        });
        return { success: true, sid: result.sid };
    } catch (error) {
        console.error('❌ Free-form error:', error.message);
        return { success: false, error: error.message };
    }
}

function formatRupiah(amount) {
    if (!amount) return 'Rp 0';
    return new Intl.NumberFormat('id-ID', {
        style: 'currency',
        currency: 'IDR',
        minimumFractionDigits: 0
    }).format(amount);
}

// ============================================================
// ENDPOINTS (YANG TIDAK BERUBAH)
// ============================================================
app.get('/test-twilio', async (req, res) => {
    res.json({
        success: true,
        twilio_configured: !!(CONFIG.twilioSid && CONFIG.twilioAuth),
        twilio_client_ready: !!twilioClient,
        whatsapp_number: CONFIG.twilioWaNumber
    });
});

app.post('/adjust.php', async (req, res) => {
    const { action, value, amount, note, content } = req.body;
    if (!action) return res.json({ success: false, message: 'Metode aksi tidak ditentukan' });

    let apiUrl = '', payload = null, method = 'GET';
    switch (action) {
        case 'check_balance':
            apiUrl = `${JAGEL_BASE_URL}/balance/check?type=username&value=${encodeURIComponent(value)}&apikey=${API_KEY_JAGEL}`;
            break;
        case 'adjust_balance':
            apiUrl = `${JAGEL_BASE_URL}/balance/adjust`;
            const cleanAmt = Math.round(Math.abs(parseFloat(amount || 0))) * (amount < 0 ? -1 : 1);
            payload = { type: 'username', value, amount: cleanAmt, note: note || 'Ship Booking', apikey: API_KEY_JAGEL };
            method = 'POST';
            break;
        case 'send_message':
            apiUrl = `${JAGEL_BASE_URL}/message/send`;
            payload = { type: 'username', value, content: content || '', apikey: API_KEY_JAGEL };
            method = 'POST';
            break;
        case 'confirm_payment':
            apiUrl = `${JAGEL_BASE_URL}/confirmPayment`;
            payload = { amount: Math.round(Math.abs(parseFloat(amount || 0))), apikey: API_KEY_JAGEL };
            method = 'POST';
            break;
        case 'get_user':
            apiUrl = `${JAGEL_BASE_URL}/user`;
            const utype = req.body.type || 'username';
            payload = { type: utype, value, apikey: API_KEY_JAGEL };
            method = 'POST';
            break;
        default:
            return res.json({ success: false, message: 'Aksi tidak dikenal' });
    }

    const response = await callJagelApi(apiUrl, payload, method);
    res.json(response.data);
});

app.post('/create-va', async (req, res) => {
    if (!dbReady) return res.status(503).json({ error: 'Database not ready' });
    try {
        const body = req.body;
        let customerId = body.customer_id || generateCustomerId();
        const partner_reff = generatePartnerReff();
        const expired = getExpiredTimestamp();
        const bankCode = body.bank_code || '008';

        const signature = generateSignatureVA({
            amount: body.amount, expired, bank_code: bankCode, partner_reff,
            customer_id: customerId, customer_name: body.customer_name,
            customer_email: body.customer_email, clientId: CONFIG.clientId, serverKey: CONFIG.serverKey,
        });

        const payload = {
            amount: body.amount, bank_code: bankCode, customer_id: customerId,
            customer_name: body.customer_name, customer_email: body.customer_email,
            customer_phone: body.customer_phone || '', partner_reff, username: CONFIG.username,
            pin: CONFIG.pin, expired, signature, url_callback: CONFIG.callbackUrl, remark: `VA ${bankCode}`
        };

        const response = await axios.post(`${CONFIG.linkquGateway}/transaction/create/va`, payload,
            { headers: { 'client-id': CONFIG.clientId, 'client-secret': CONFIG.clientSecret }, timeout: 30000 });

        const result = response.data;
        const vaNumber = result.virtual_account || null;
        const isSuccess = result.status === 'SUCCESS' || result.response_code === '00';

        await pool.execute(`
            INSERT INTO inquiry_va (partner_reff, customer_name, customer_phone, customer_email, 
             bank_code, va_number, amount, expired, response_raw, created_at, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [partner_reff, body.customer_name, body.customer_phone || null, body.customer_email,
                bankCode, vaNumber, body.amount, expired, JSON.stringify(result), mysqlNow(), isSuccess ? 'PENDING' : 'FAILED']);

        res.json({ ...result, partner_reff, customer_id: customerId, db_saved: true });
    } catch (err) {
        console.error('❌ [CREATE-VA] Error:', err.message);
        res.status(500).json({ error: 'Failed to create VA', detail: err.message });
    }
});

app.post('/create-qris', async (req, res) => {
    if (!dbReady) return res.status(503).json({ error: 'Database not ready' });
    try {
        const body = req.body;
        let customerId = body.customer_id || generateCustomerId();
        const partner_reff = generatePartnerReff();
        const expired = getExpiredTimestamp();

        const signature = generateSignatureQRIS({
            amount: body.amount, expired, partner_reff, customer_id: customerId,
            customer_name: body.customer_name, customer_email: body.customer_email,
            clientId: CONFIG.clientId, serverKey: CONFIG.serverKey,
        });

        const payload = {
            amount: body.amount, customer_id: customerId, customer_name: body.customer_name,
            customer_email: body.customer_email, customer_phone: body.customer_phone || '',
            partner_reff, username: CONFIG.username, pin: CONFIG.pin, expired, signature, url_callback: CONFIG.callbackUrl,
        };

        const response = await axios.post(`${CONFIG.linkquGateway}/transaction/create/qris`, payload,
            { headers: { 'client-id': CONFIG.clientId, 'client-secret': CONFIG.clientSecret }, timeout: 30000 });

        const result = response.data;
        let qrisImageBuffer = null;
        if (result?.imageqris) {
            try {
                const imgResp = await axios.get(result.imageqris.trim(), { responseType: 'arraybuffer', timeout: 10000 });
                qrisImageBuffer = Buffer.from(imgResp.data);
            } catch (imgErr) { }
        }

        const isSuccess = result.status === 'SUCCESS' || result.response_code === '00';
        await pool.execute(`
            INSERT INTO inquiry_qris (partner_reff, customer_id, customer_name, amount, expired,
             customer_phone, customer_email, qris_url, qris_image, response_raw, created_at, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [partner_reff, customerId, body.customer_name, body.amount, expired, body.customer_phone || null,
                body.customer_email, result?.imageqris || null, qrisImageBuffer, JSON.stringify(result), mysqlNow(), isSuccess ? 'PENDING' : 'FAILED']);

        res.json({ ...result, partner_reff, customer_id: customerId, db_saved: true });
    } catch (err) {
        console.error('❌ [CREATE-QRIS] Error:', err.message);
        res.status(500).json({ error: 'Failed to create QRIS', detail: err.message });
    }
});

async function updateOrderStatusFromCallback(partner_reff, paymentStatus) {
    try {
        const [result] = await pool.execute(
            `UPDATE orders SET payment_status = ?, 
             order_status = CASE WHEN order_status = 'PENDING' AND ? = 'PAID' THEN 'SEARCHING' ELSE order_status END,
             updated_at = ? WHERE partner_reff = ?`,
            [paymentStatus, paymentStatus, mysqlNow(), partner_reff]);
        if (result.affectedRows > 0) {
            const [orders] = await pool.execute('SELECT * FROM orders WHERE partner_reff = ?', [partner_reff]);
            if (orders.length > 0) await sendPaymentSuccessNotification(orders[0]);
            return true;
        }
        return false;
    } catch (error) {
        console.error('❌ Error updating order status:', error.message);
        return false;
    }
}

async function sendPaymentSuccessNotification(order) {
    const message = `✅ *PEMBAYARAN BERHASIL!*
━━━━━━━━━━━━━━━━━━━━━
Halo *${order.customer_name}*,

Pembayaran Anda sebesar *${formatRupiah(order.total_price)}* telah berhasil.

Status pesanan: *${order.order_status}*
Order ID: ${order.order_id}

Terima kasih! 🙏`;
    await sendWhatsAppFreeForm(order.customer_phone, message);
}

app.post('/callback', async (req, res) => {
    console.log('\n📞 [CALLBACK] Payload:', JSON.stringify(req.body, null, 2));
    const { partner_reff, serialnumber } = req.body;
    if (!partner_reff) return res.status(400).json({ error: 'partner_reff wajib ada' });

    const connection = await pool.getConnection();
    let tableName = null, dbData = null;

    try {
        await connection.beginTransaction();
        let [rows] = await connection.execute(
            `SELECT status, customer_name, amount, bank_code as method_code, 'VA' as type FROM inquiry_va WHERE partner_reff = ? FOR UPDATE`,
            [partner_reff]);
        if (rows.length > 0) { tableName = 'inquiry_va'; dbData = rows[0]; }

        if (!tableName) {
            [rows] = await connection.execute(
                `SELECT status, customer_name, amount, 'QRIS' as method_code, 'QRIS' as type FROM inquiry_qris WHERE partner_reff = ? FOR UPDATE`,
                [partner_reff]);
            if (rows.length > 0) { tableName = 'inquiry_qris'; dbData = rows[0]; }
        }

        if (!tableName || !dbData) {
            await connection.rollback();
            return res.status(404).json({ error: 'Data transaksi tidak ditemukan' });
        }

        if (dbData.status === 'SUKSES') {
            await connection.rollback();
            return res.json({ message: 'Sudah diproses sebelumnya.' });
        }

        await connection.execute(`UPDATE ${tableName} SET status = 'SUKSES' WHERE partner_reff = ?`, [partner_reff]);
        await connection.commit();

        let methodCode = dbData.method_code;
        await addBalance(dbData.amount, dbData.customer_name, methodCode, serialnumber || partner_reff);
        await updateOrderStatusFromCallback(partner_reff, 'PAID');

        res.json({ message: 'Callback diterima dan saldo ditambahkan' });
    } catch (err) {
        console.error('❌ [CALLBACK] Error:', err.message);
        try { await connection.rollback(); } catch (e) { }
        res.status(500).json({ error: 'Internal Server Error', detail: err.message });
    } finally {
        connection.release();
    }
});

app.post('/sync-all-orders', async (req, res) => {
    try {
        const [orders] = await pool.execute(`SELECT * FROM orders WHERE payment_status = 'PAID' AND order_status = 'PENDING'`);
        let updated = 0;
        for (const order of orders) {
            const newStatus = order.driver_id ? 'CONFIRMED' : 'SEARCHING';
            await pool.execute(`UPDATE orders SET order_status = ?, updated_at = ? WHERE order_id = ?`, [newStatus, mysqlNow(), order.order_id]);
            updated++;
        }
        res.json({ success: true, message: `Synced ${updated} orders` });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/sync-order-status', async (req, res) => {
    const { partner_reff } = req.body;
    if (!partner_reff) return res.status(400).json({ error: 'partner_reff required' });
    try {
        let [vaRows] = await pool.execute('SELECT status FROM inquiry_va WHERE partner_reff = ?', [partner_reff]);
        let paymentStatus = null;
        if (vaRows.length > 0 && vaRows[0].status === 'SUKSES') paymentStatus = 'PAID';
        if (!paymentStatus) {
            let [qrisRows] = await pool.execute('SELECT status FROM inquiry_qris WHERE partner_reff = ?', [partner_reff]);
            if (qrisRows.length > 0 && qrisRows[0].status === 'SUKSES') paymentStatus = 'PAID';
        }
        if (paymentStatus) {
            await updateOrderStatusFromCallback(partner_reff, paymentStatus);
            res.json({ success: true, message: 'Order status synchronized', status: paymentStatus });
        } else {
            res.json({ success: false, message: 'Payment not found' });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/download-qr/:partner_reff', async (req, res) => {
    const { partner_reff } = req.params;
    try {
        const [rows] = await pool.execute('SELECT qris_image, qris_url FROM inquiry_qris WHERE partner_reff = ?', [partner_reff]);
        if (!rows.length) return res.status(404).send('QRIS tidak ditemukan');
        if (rows[0].qris_image) {
            res.setHeader('Content-Disposition', `attachment; filename="qris-${partner_reff}.png"`);
            res.setHeader('Content-Type', 'image/png');
            return res.send(rows[0].qris_image);
        }
        if (!rows[0].qris_url) return res.status(404).send('URL QRIS tidak tersedia');
        const imgResp = await axios.get(rows[0].qris_url.trim(), { responseType: 'arraybuffer', timeout: 10000 });
        const buffer = Buffer.from(imgResp.data);
        await pool.execute('UPDATE inquiry_qris SET qris_image = ? WHERE partner_reff = ?', [buffer, partner_reff]);
        res.setHeader('Content-Disposition', `attachment; filename="qris-${partner_reff}.png"`);
        res.setHeader('Content-Type', 'image/png');
        res.send(buffer);
    } catch (err) {
        res.status(500).send('Terjadi kesalahan server');
    }
});

app.get('/check-status/:partner_reff', async (req, res) => {
    const { partner_reff } = req.params;
    if (!partner_reff) return res.status(400).json({ rc: '01', message: 'partner_reff diperlukan' });
    try {
        let transaction = null;
        let [rows] = await pool.execute('SELECT partner_reff, status, amount, bank_code as method, created_at FROM inquiry_va WHERE partner_reff = ?', [partner_reff]);
        if (rows.length > 0) { transaction = { ...rows[0], type: 'VA' }; }
        if (!transaction) {
            [rows] = await pool.execute('SELECT partner_reff, status, amount, created_at FROM inquiry_qris WHERE partner_reff = ?', [partner_reff]);
            if (rows.length > 0) { transaction = { ...rows[0], type: 'QRIS', method: 'QRIS' }; }
        }
        if (!transaction) return res.status(404).json({ rc: '404', message: 'Transaksi tidak ditemukan' });
        const status_trx = transaction.status === 'SUKSES' ? 'success' : 'pending';
        res.json({ rc: '00', message: 'Success', data: { ...transaction, status_trx, checked_at: new Date().toISOString() } });
    } catch (err) {
        res.status(500).json({ rc: '99', message: 'Internal server error', error: err.message });
    }
});

app.post('/add-balance', async (req, res) => {
    const { amount, username, method_code, serial_number } = req.body;
    if (!amount || !username) return res.status(400).json({ success: false, message: 'amount dan username wajib diisi' });
    try {
        const result = await addBalance(amount, username, (method_code || 'VA').toUpperCase(), serial_number || `MANUAL-${Date.now()}`);
        res.json({ success: true, ...result });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ============================================================
// ✅ ENDPOINT: POST /orders (YANG DIPERBAIKI)
// ============================================================
app.post('/orders', async (req, res) => {
    console.log('\n🛒 [ORDERS-CREATE] Request received:', JSON.stringify(req.body, null, 2));

    if (!dbReady) return res.status(503).json({ error: 'Database not ready' });

    try {
        const body = req.body;
        const order_id = body.order_id || `ORD-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
        const now = mysqlNow();

        let orderStatus = body.order_status || 'PENDING';
        if (body.payment_status === 'PAID' && orderStatus === 'PENDING') {
            orderStatus = 'SEARCHING';
            console.log(`✅ Payment already PAID, setting order_status to SEARCHING`);
        }

        await pool.execute(`
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
            order_id, orderStatus, body.order_date || now, body.order_note || null,
            body.service_type || null, body.service_name || null, body.service_description || null,
            body.origin_address || null, body.origin_lat || null, body.origin_lng || null,
            body.destination_address || null, body.destination_lat || null, body.destination_lng || null,
            body.distance_km || null, body.estimated_duration_min || null,
            body.base_price || 0, body.service_fee || 0, body.discount || 0, body.total_price || 0,
            body.payment_method || null, body.payment_status || 'UNPAID', body.partner_reff || null,
            body.mitra_id || null, body.mitra_name || null, body.mitra_phone || null,
            body.driver_id || null, body.driver_name || null, body.driver_phone || null,
            body.driver_photo || null, body.driver_address || null, body.driver_lat || null, body.driver_lng || null,
            body.customer_name || null, body.customer_phone || null, now, now]);

        res.status(201).json({ success: true, message: 'Order berhasil dibuat', order_id, order_status: orderStatus });
    } catch (err) {
        console.error('❌ [ORDERS-CREATE] Error:', err.message);
        res.status(500).json({ error: 'Gagal membuat order', detail: err.message });
    }
});

// ============================================================
// ENDPOINT: GET /orders (TIDAK BERUBAH)
// ============================================================
app.get('/orders', async (req, res) => {
    try {
        const { driver_id, mitra_id, status, limit = 50, offset = 0 } = req.query;
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
        let parsedLimit = Math.min(parseInt(limit) || 50, 1000);
        let parsedOffset = Math.max(parseInt(offset) || 0, 0);

        const query = `SELECT * FROM orders ${whereClause} ORDER BY created_at DESC LIMIT ${parsedLimit} OFFSET ${parsedOffset}`;
        const [results] = await pool.execute(query, values);

        res.json({ success: true, count: results.length, data: results });
    } catch (err) {
        console.error('❌ [ORDERS-LIST] Error:', err.message);
        res.status(500).json({ error: 'Gagal mengambil data orders', detail: err.message });
    }
});

// ============================================================
// ENDPOINT: GET /orders/:order_id (TIDAK BERUBAH)
// ============================================================
app.get('/orders/:order_id', async (req, res) => {
    const { order_id } = req.params;
    try {
        const [rows] = await pool.execute('SELECT * FROM orders WHERE order_id = ?', [order_id]);
        if (!rows.length) return res.status(404).json({ success: false, message: 'Order tidak ditemukan' });
        res.json({ success: true, data: rows[0] });
    } catch (err) {
        console.error('❌ [ORDERS-DETAIL] Error:', err.message);
        res.status(500).json({ error: 'Gagal mengambil detail order', detail: err.message });
    }
});

// ============================================================
// ENDPOINT: PUT /orders/:order_id (TIDAK BERUBAH)
// ============================================================
app.put('/orders/:order_id', async (req, res) => {
    const { order_id } = req.params;
    const body = req.body;

    try {
        const allowedFields = [
            'order_status', 'order_note', 'origin_address', 'origin_lat', 'origin_lng',
            'destination_address', 'destination_lat', 'destination_lng', 'distance_km',
            'estimated_duration_min', 'base_price', 'service_fee', 'discount', 'total_price',
            'payment_method', 'payment_status', 'partner_reff', 'mitra_id', 'mitra_name', 'mitra_phone',
            'driver_id', 'driver_name', 'driver_phone', 'driver_photo', 'driver_address', 'driver_lat', 'driver_lng',
            'customer_name', 'customer_phone'
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

        const [result] = await pool.execute(`UPDATE orders SET ${setClauses.join(', ')} WHERE order_id = ?`, values);
        if (result.affectedRows === 0) {
            return res.status(404).json({ success: false, message: 'Order tidak ditemukan' });
        }

        if (body.driver_id && body.driver_name) {
            await pool.execute(`UPDATE orders SET order_status = 'CONFIRMED', updated_at = ? WHERE order_id = ?`, [mysqlNow(), order_id]);
        }

        res.json({ success: true, message: 'Order berhasil diupdate', order_id });
    } catch (err) {
        console.error('❌ [ORDERS-UPDATE] Error:', err.message);
        res.status(500).json({ error: 'Gagal mengupdate order', detail: err.message });
    }
});

// ============================================================
// ENDPOINT: POST /driver-confirmation (DIPERBAIKI - PRE-ASSIGN DRIVER)
// ============================================================
// ============================================================
// ENDPOINT: POST /driver-confirmation (UPDATED - DENGAN DATA LENGKAP)
// ============================================================
app.post('/driver-confirmation', async (req, res) => {
    const { order_id, driver_id, driver_name, driver_phone, customer_name, customer_phone, total_amount, jumlah_toko, order_data } = req.body;

    console.log(`\n🔍 [DRIVER-CONFIRMATION] Checking order ${order_id} in DB...`);

    // ✅ CEK ORDER DI DB DULU
    try {
        const [existing] = await pool.execute('SELECT order_id, customer_name, customer_phone FROM orders WHERE order_id = ?', [order_id]);
        if (existing.length === 0) {
            console.error(`❌ ORDER ${order_id} TIDAK ADA DI DB SAAT driver-confirmation dipanggil!`);
            console.error(`   Ini berarti POST /orders belum selesai atau gagal`);

            // Return error ke frontend supaya frontend tahu
            return res.status(404).json({
                success: false,
                error: `Order ${order_id} belum ada di database. POST /orders harus dipanggil lebih dulu.`,
                order_id
            });
        }
        console.log(`✅ Order ${order_id} found in DB, customer: ${existing[0].customer_name}`);
    } catch (dbErr) {
        console.error(`❌ DB check error: ${dbErr.message}`);
        return res.status(500).json({ success: false, error: dbErr.message });
    }

    const normalizedDriverPhone = normalizePhoneNumber(driver_phone);
    const normalizedCustomerPhone = normalizePhoneNumber(customer_phone);

    driverConfirmations.set(order_id, {
        driver_id,
        driver_name,
        driver_phone: normalizedDriverPhone,
        customer_name,
        customer_phone: normalizedCustomerPhone,  // ✅ SIMPAN customer_phone!
        total_amount,
        jumlah_toko,
        order_data: order_data || {},
        status: 'pending',
        timestamp: Date.now(),
        expiresAt: Date.now() + (3 * 60 * 1000)
    });

    // Pre-assign driver
    try {
        await pool.execute(`
            UPDATE orders SET driver_id = ?, driver_name = ?, driver_phone = ?, updated_at = ?
            WHERE order_id = ? AND driver_id IS NULL
        `, [driver_id, driver_name, normalizedDriverPhone, mysqlNow(), order_id]);
    } catch (error) {
        console.log(`⚠️ Pre-assign error: ${error.message}`);
    }

    const variables = {
        "1": driver_name,
        "2": customer_name,
        "3": total_amount,
        "4": (jumlah_toko || 1).toString()
    };

    const whatsappResult = await sendWhatsAppTemplate(driver_phone, CONFIG.templateDriverConfirmation, variables);
    res.json({ success: whatsappResult.success, order_id, ...whatsappResult });
});
// ============================================================
// ENDPOINTS YANG TIDAK BERUBAH (send-order-details, send-driver-rejected, dll)
// ============================================================
app.post('/send-order-details', async (req, res) => {
    const { order_id, driver_phone, driver_name, customer_name, customer_phone, stores_detail, total } = req.body;
    const driverResult = await sendWhatsAppTemplate(driver_phone, CONFIG.templateDriverOrderAccepted, {
        "1": driver_name, "2": customer_name, "3": customer_phone, "4": order_id,
        "5": stores_detail || 'Detail pesanan terlampir', "6": total
    });
    const customerResult = await sendWhatsAppTemplate(customer_phone, CONFIG.templateCustomerOrderConfirmed, {
        "1": customer_name, "2": driver_name, "3": driver_phone, "4": order_id,
        "5": stores_detail || 'Detail pesanan terlampir', "6": total
    });
    res.json({ success: driverResult.success && customerResult.success, driver: driverResult, customer: customerResult });
});

app.post('/send-driver-rejected', async (req, res) => {
    const { customer_phone, customer_name } = req.body;
    const result = await sendWhatsAppTemplate(customer_phone, CONFIG.templateDriverRejected, { "1": customer_name });
    res.json({ success: result.success, ...result });
});

app.post('/send-no-driver', async (req, res) => {
    const { customer_phone, customer_name, total_amount } = req.body;
    const result = await sendWhatsAppTemplate(customer_phone, CONFIG.templateNoDriverAvailable, { "1": customer_name, "2": total_amount, "3": CONFIG.csNumber });
    res.json({ success: result.success, ...result });
});

app.get('/driver/accept/:orderId', async (req, res) => {
    const { orderId } = req.params;
    const confirmation = driverConfirmations.get(orderId);
    if (confirmation && confirmation.status === 'pending' && Date.now() < confirmation.expiresAt) {
        confirmation.status = 'accepted';
        driverConfirmations.set(orderId, confirmation);
        res.send(`<html><body><h2>✅ Pesanan Diterima!</h2><p>Order ID: ${orderId}</p></body></html>`);
    } else {
        res.send(`<html><body><h2>⏰ Konfirmasi Kadaluwarsa</h2></body></html>`);
    }
});

app.get('/driver/reject/:orderId', async (req, res) => {
    const { orderId } = req.params;
    const confirmation = driverConfirmations.get(orderId);
    if (confirmation && confirmation.status === 'pending' && Date.now() < confirmation.expiresAt) {
        confirmation.status = 'rejected';
        driverConfirmations.set(orderId, confirmation);
        res.send(`<html><body><h2>❌ Pesanan Ditolak</h2></body></html>`);
    } else {
        res.send(`<html><body><h2>⏰ Konfirmasi Kadaluwarsa</h2></body></html>`);
    }
});

app.get('/check-confirmation/:orderId', async (req, res) => {
    const { orderId } = req.params;
    const confirmation = driverConfirmations.get(orderId);
    if (confirmation) {
        res.json({ status: confirmation.status, driver_id: confirmation.driver_id, driver_name: confirmation.driver_name });
    } else {
        res.json({ status: 'not_found' });
    }
});

app.post('/send-whatsapp', async (req, res) => {
    const { to, message, use_template, template_sid, variables } = req.body;
    let result;
    if (use_template && template_sid) {
        result = await sendWhatsAppTemplate(to, template_sid, variables || {});
    } else {
        result = await sendWhatsAppFreeForm(to, message);
    }
    res.json(result);
});

// ============================================================
// ✅ WEBHOOK WHATSAPP (DIPERBAIKI - DENGAN PENDING CHECK)
// ============================================================
app.post('/webhook/whatsapp', express.urlencoded({ extended: true }), async (req, res) => {
    console.log('\n📨 [WEBHOOK] Body:', JSON.stringify(req.body, null, 2));

    const messageBody = req.body.Body || req.body.body;
    const fromNumber = req.body.From || req.body.from;

    if (!messageBody || !fromNumber) {
        console.error('❌ Missing required fields');
        return res.sendStatus(400);
    }

    const rawDriverPhone = fromNumber.replace('whatsapp:', '');
    const driverPhone = normalizePhoneNumber(rawDriverPhone);
    const message = messageBody.trim().toUpperCase();

    console.log(`📱 Driver: ${driverPhone}, Message: ${message}`);

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
        if (message === 'ACCEPT' || message === 'TERIMA') {
            foundConfirmation.status = 'accepted';
            driverConfirmations.set(foundOrderId, foundConfirmation);
            console.log(`✅ Driver ACCEPTED order ${foundOrderId}`);

            await sendWhatsAppFreeForm(rawDriverPhone, '✅ Terima kasih! Detail pesanan akan kami kirimkan segera.');
            await sendOrderDetailsToDriver(foundOrderId, foundConfirmation);
            await notifyCustomerOrderAccepted(foundOrderId, foundConfirmation);
        } else if (message === 'REJECT' || message === 'TOLAK') {
            foundConfirmation.status = 'rejected';
            driverConfirmations.set(foundOrderId, foundConfirmation);
            console.log(`❌ Driver REJECTED order ${foundOrderId}`);
            await sendWhatsAppFreeForm(rawDriverPhone, '❌ Pesanan ditolak. Terima kasih.');
            await sendWhatsAppTemplate(foundConfirmation.customer_phone, CONFIG.templateDriverRejected, { "1": foundConfirmation.customer_name });
        }
    } else {
        console.log(`⚠️ No pending order found for driver ${driverPhone}`);
    }
    res.sendStatus(200);
});

// ============================================================
// ✅ FUNGSI KIRIM DETAIL ORDER KE DRIVER (YANG DIPERBAIKI - DENGAN UPDATE ORDER)
// ============================================================
// ============================================================
// FUNGSI KIRIM DETAIL ORDER KE DRIVER (FIXED - DENGAN DATA LENGKAP)
// ============================================================
// ============================================================
// FUNGSI KIRIM DETAIL ORDER KE DRIVER (FINAL - TIDAK PERNAH MEMBUAT ORDER BARU)
// ============================================================
async function sendOrderDetailsToDriver(orderId, confirmation) {
    console.log(`📦 [SEND-ORDER-DETAILS] Order: ${orderId}`);

    try {
        // ✅ CEK APAKAH ORDER ADA DI DATABASE
        let [orders] = await pool.execute('SELECT * FROM orders WHERE order_id = ?', [orderId]);

        // ✅ JIKA ORDER TIDAK DITEMUKAN - JANGAN BUAT BARU!
        if (orders.length === 0) {
            console.error(`❌ CRITICAL ERROR: Order ${orderId} not found in database!`);
            console.error(`   Driver: ${confirmation.driver_name}`);
            console.error(`   Customer: ${confirmation.customer_name}`);
            console.error(`   Ini berarti frontend mengirim order_id yang salah ke driver-confirmation`);

            // Kirim notifikasi ke admin via WhatsApp
            const adminMessage = `🚨 *ERROR: Order Not Found!*
━━━━━━━━━━━━━━━━━━━━━
Order ID: ${orderId}
Driver: ${confirmation.driver_name}
Customer: ${confirmation.customer_name}
Phone: ${confirmation.customer_phone}

⚠️ Frontend mengirim order_id yang salah!
Order tidak dapat di-assign ke driver.

SOLUSI: Pastikan frontend menggunakan order_id yang SAMA
dengan yang dikirim ke POST /orders`;

            await sendWhatsAppFreeForm(CONFIG.adminWaNumber.replace('whatsapp:', ''), adminMessage);
            return;  // ← STOP! JANGAN BUAT ORDER BARU!
        }

        const order = orders[0];

        // ✅ CEK APAKAH DRIVER SUDAH TERASSIGN (HINDARI DUPLIKAT)
        if (order.driver_id) {
            console.log(`ℹ️ Order ${orderId} already has driver: ${order.driver_name}`);
            return;
        }

        // ✅ UPDATE ORDER YANG SUDAH ADA (BUKAN MEMBUAT BARU)
        const [updateResult] = await pool.execute(`
            UPDATE orders SET 
                driver_id = ?,
                driver_name = ?,
                driver_phone = ?,
                order_status = 'CONFIRMED',
                updated_at = ?
            WHERE order_id = ? AND driver_id IS NULL
        `, [
            confirmation.driver_id,
            confirmation.driver_name,
            confirmation.driver_phone,
            mysqlNow(),
            orderId
        ]);

        if (updateResult.affectedRows === 0) {
            console.log(`⚠️ Order ${orderId} already has a driver, no update needed`);
            return;
        }

        console.log(`✅ Driver ${confirmation.driver_name} assigned to order ${orderId}`);
        console.log(`   Order status updated to CONFIRMED`);

        // ✅ KIRIM NOTIFIKASI KE DRIVER (TEMPLATE)
        const driverVariables = {
            "1": confirmation.driver_name,
            "2": order.customer_name,
            "3": order.customer_phone,
            "4": orderId,
            "5": order.order_note || "Pesanan antar makanan",
            "6": formatRupiah(order.total_price)
        };

        await sendWhatsAppTemplate(
            confirmation.driver_phone,
            CONFIG.templateDriverOrderAccepted,
            driverVariables
        );
        console.log(`✅ Order details sent to driver ${confirmation.driver_name}`);

        // ✅ KIRIM NOTIFIKASI KE CUSTOMER
        const customerMessage = `🚗 *DRIVER TELAH DITUGASKAN!*
━━━━━━━━━━━━━━━━━━━━━
Halo *${order.customer_name}*,

Driver *${confirmation.driver_name}* telah ditugaskan!

📋 *Detail Pesanan:*
Order ID: ${order.order_id}
Total: ${formatRupiah(order.total_price)}
${order.origin_address ? `📍 Asal: ${order.origin_address.substring(0, 50)}...` : ''}
${order.destination_address ? `📍 Tujuan: ${order.destination_address.substring(0, 50)}...` : ''}

Driver akan segera menghubungi Anda. 🙏`;

        await sendWhatsAppFreeForm(order.customer_phone, customerMessage);
        console.log(`✅ Customer notification sent to ${order.customer_phone}`);

    } catch (error) {
        console.error(`❌ Error in sendOrderDetailsToDriver:`, error.message);
        console.error(`   Order ID: ${orderId}`);
        console.error(`   Driver: ${confirmation.driver_name}`);

        // Kirim notifikasi error ke admin
        const errorMessage = `❌ *Error in sendOrderDetailsToDriver*
Order: ${orderId}
Error: ${error.message}`;
        await sendWhatsAppFreeForm(CONFIG.adminWaNumber.replace('whatsapp:', ''), errorMessage);
    }
}
// ============================================================
// FUNGSI NOTIFIKASI KE CUSTOMER
// ============================================================
async function notifyCustomerOrderAccepted(orderId, confirmation) {
    console.log(`📧 [NOTIFY-CUSTOMER] Order: ${orderId}`);
    try {
        const [orders] = await pool.execute('SELECT * FROM orders WHERE order_id = ?', [orderId]);
        if (orders.length === 0) return;
        const order = orders[0];

        if (order.order_status !== 'CONFIRMED') {
            await pool.execute(`UPDATE orders SET order_status = 'CONFIRMED', driver_id = ?, driver_name = ?, driver_phone = ?, updated_at = ? WHERE order_id = ?`,
                [confirmation.driver_id, confirmation.driver_name, confirmation.driver_phone, mysqlNow(), orderId]);
        }

        await sendWhatsAppTemplate(order.customer_phone, CONFIG.templateCustomerOrderConfirmed, {
            "1": order.customer_name, "2": confirmation.driver_name, "3": confirmation.driver_phone,
            "4": orderId, "5": "Pesanan Anda telah dikonfirmasi oleh driver", "6": formatRupiah(order.total_price)
        });
    } catch (error) {
        console.error(`❌ Error:`, error.message);
    }
}


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
// DEBUG ENDPOINTS
// ============================================================
app.get('/debug/driver-confirmations', async (req, res) => {
    const confirmations = [];
    for (const [orderId, conf] of driverConfirmations) {
        confirmations.push({
            order_id: orderId, status: conf.status, driver_name: conf.driver_name,
            driver_phone: conf.driver_phone, customer_name: conf.customer_name,
            customer_phone: conf.customer_phone, total_amount: conf.total_amount
        });
    }
    res.json({ total_pending: driverConfirmations.size, confirmations });
});

app.post('/fix-all-missing-orders', async (req, res) => {
    console.log('🔧 Fixing all missing orders from driver confirmations...');
    const fixedOrders = [], errors = [];
    for (const [orderId, confirmation] of driverConfirmations) {
        if (confirmation.status === 'accepted') {
            try {
                const [existing] = await pool.execute('SELECT order_id FROM orders WHERE order_id = ?', [orderId]);
                if (existing.length === 0) {
                    const now = mysqlNow();
                    let parsedTotal = 21000;
                    if (confirmation.total_amount) {
                        parsedTotal = parseInt(confirmation.total_amount.replace(/\D/g, '')) || 21000;
                    }
                    await pool.execute(`
                        INSERT INTO orders (order_id, order_status, order_date, customer_name, customer_phone,
                         total_price, payment_status, driver_id, driver_name, driver_phone, created_at, updated_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        ON DUPLICATE KEY UPDATE driver_id = VALUES(driver_id), driver_name = VALUES(driver_name),
                        driver_phone = VALUES(driver_phone), order_status = 'CONFIRMED', updated_at = VALUES(updated_at)`,
                        [orderId, 'CONFIRMED', now, confirmation.customer_name, confirmation.customer_phone || '082323907426',
                            parsedTotal, 'PAID', confirmation.driver_id, confirmation.driver_name, confirmation.driver_phone, now, now]);
                    fixedOrders.push(orderId);
                }
            } catch (error) {
                errors.push({ orderId, error: error.message });
            }
        }
    }
    res.json({ success: true, fixed_count: fixedOrders.length, fixed_orders: fixedOrders, errors });
});

// ============================================================
// HEALTH CHECK
// ============================================================
app.get('/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString(), database_ready: dbReady });
});

// ============================================================
// START SERVER
// ============================================================
const PORT = CONFIG.port;
app.listen(PORT, () => {
    console.log(`\n🚀 Server running on port ${PORT}`);
    console.log(`📍 URL: http://localhost:${PORT}`);
    console.log('\n✅ All endpoints ready!');
    console.log('📱 Driver confirmation flow is now FIXED!\n');
});