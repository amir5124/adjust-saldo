'use strict';

// ── DNS FIX — WAJIB PALING ATAS sebelum require apapun ──
const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');
dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);

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
app.use(express.urlencoded({ extended: true }));

// ============================================================
// KONFIGURASI
// ============================================================


const CONFIG = {
    clientId: process.env.LINKQU_CLIENT_ID || 'testing',
    clientSecret: process.env.LINKQU_CLIENT_SECRET || '123',
    username: process.env.LINKQU_USERNAME || 'LI307GXIN',
    pin: process.env.LINKQU_PIN || '2K2NPCBBNNTovgB',
    serverKey: process.env.LINKQU_SERVER_KEY || 'LinkQu@2020',
    callbackUrl: process.env.CALLBACK_URL || 'https://jagel.siappgo.id/callback',
    jagelApiKey: process.env.JAGEL_APIKEY || 'c6wA9HlUkN2PYEpEOYmDwiehrw7QMIVAvPETMpR2NRN4jjnYPO',
    linkquGateway: process.env.LINKQU_GATEWAY || 'https://gateway-dev.linkqu.id/linkqu-partner',
    jagelBaseUrl: process.env.JAGEL_BASE_URL || 'https://api.jagel.id/v1',
    port: parseInt(process.env.PORT || '3000'),

    // Twilio Configuration
    twilioSid: process.env.TWILIO_ACCOUNT_SID || '',
    twilioAuth: process.env.TWILIO_AUTH_TOKEN || '',
    twilioWaNumber: process.env.TWILIO_WHATSAPP_NUMBER || 'whatsapp:+14155238886',
    csNumber: process.env.CS_PHONE_NUMBER || '082323907526',

    // Twilio Template SIDs
    templateDriverConfirmation: process.env.TWILIO_TEMPLATE_DRIVER_CONFIRMATION || 'HX0f899a4bc82aca9611ef757228c3ba61',
    templateDriverOrderAccepted: process.env.TWILIO_TEMPLATE_DRIVER_ACCEPTED || 'HX05ecb4baa13a96aee45215801328be65',
    templateCustomerOrderConfirmed: process.env.TWILIO_TEMPLATE_CUSTOMER_CONFIRMED || 'HX9e996a15a5f28fb3ec2cdd7d84ab85a2',
    templateDriverRejected: process.env.TWILIO_TEMPLATE_DRIVER_REJECTED || 'HX883e49ca163a114e5674f0be7dd53bec',
    templateNoDriverAvailable: process.env.TWILIO_TEMPLATE_NO_DRIVER || 'HX83dfee2050db21b4b4ffc571c31690da',
    templateDriverOrderComplete: process.env.TWILIO_TEMPLATE_DRIVER_DONE || 'HXd9c08ad72d426231bbf65dd4eb3e8177',
    templateCustomerOrderReceived: process.env.TWILIO_TEMPLATE_CUSTOMER_DONE || 'HX5d8d7be440261e9d34c9152074e0242d',
    templateMitraOrderNotify: process.env.TWILIO_TEMPLATE_MITRA_NOTIFY || 'HX7645fe3838f314b321d34c8e8c868bee',

};

// ============================================================
// TWILIO INITIALIZATION
// ============================================================
let twilioClient = null;

function initTwilio() {
    console.log('\n🔧 [TWILIO] Initializing...');
    if (!CONFIG.twilioSid || !CONFIG.twilioAuth) {
        console.error('❌ TWILIO CREDENTIALS MISSING!');
        return null;
    }
    try {
        twilioClient = twilio(CONFIG.twilioSid, CONFIG.twilioAuth);
        console.log('✅ Twilio client initialized');
        return twilioClient;
    } catch (error) {
        console.error('❌ Twilio init failed:', error.message);
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
});

// ============================================================
// GLOBAL VARIABLES
// ============================================================
const driverConfirmations = new Map();
const pendingCompletions = new Map();

// ============================================================
// SCHEDULER: Auto-complete order DELIVERED yang belum dikonfirmasi 24 jam
// Cek setiap 30 menit
// ============================================================
setInterval(async () => {
    console.log(`\n⏰ [AUTO-SETTLE] Checking unconfirmed delivered orders...`);
    try {
        const [rows] = await pool.execute(`
            SELECT * FROM orders 
            WHERE order_status = 'DELIVERED' 
            AND updated_at <= NOW() - INTERVAL 24 HOUR
        `);

        if (rows.length === 0) {
            console.log(`✅ [AUTO-SETTLE] No pending orders found`);
            return;
        }

        console.log(`⚠️ [AUTO-SETTLE] Found ${rows.length} order(s) to auto-settle`);

        for (const order of rows) {
            console.log(`⏰ [AUTO-SETTLE] Processing: ${order.order_id}`);
            try {
                await processOrderSettlement(order);
                console.log(`✅ [AUTO-SETTLE] Settled: ${order.order_id}`);
            } catch (err) {
                console.error(`❌ [AUTO-SETTLE] Failed ${order.order_id}:`, err.message);
            }
            // Delay antar order agar tidak flood API
            await new Promise(r => setTimeout(r, 500));
        }
    } catch (err) {
        console.error(`❌ [AUTO-SETTLE] Error:`, err.message);
    }
}, 30 * 60 * 1000); // cek setiap 30 menit

const LOG_DIR = path.join(__dirname, 'logs');
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

function logToFile(message, type = 'INFO') {
    const timestamp = new Date().toISOString();
    const logPath = path.join(LOG_DIR, `${type.toLowerCase()}.log`);
    fs.appendFile(logPath, `[${timestamp}] [${type}] ${message}\n`, (err) => {
        if (err) console.error('Log error:', err.message);
    });
    console.log(message);
}

// ============================================================
// HELPER FUNCTIONS
// ============================================================
function mysqlNow() {
    return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

// ✅ Ubah 62xxx -> 08xxx untuk ditampilkan di WhatsApp
function formatPhoneDisplay(phone) {
    if (!phone) return '-';
    let cleaned = phone.toString().replace(/\D/g, '');
    if (cleaned.startsWith('62')) cleaned = '0' + cleaned.substring(2);
    return cleaned;
}

function generatePartnerReff() {
    return `INV-${Date.now()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
}

function getExpiredTimestamp(minutes = 15) {
    return moment.tz('Asia/Jakarta').add(minutes, 'minutes').format('YYYYMMDDHHmmss');
}

function generateCustomerId() {
    return Date.now().toString().slice(-5) + Math.floor(Math.random() * 90000 + 10000);
}

function hmac256(serverKey, data) {
    return crypto.createHmac('sha256', serverKey).update(data).digest('hex');
}

function cleanValue(str) {
    return String(str).replace(/[^0-9a-zA-Z]/g, '').toLowerCase();
}

function generateSignatureVA(p) {
    const raw = cleanValue(p.amount + p.expired + p.bank_code + p.partner_reff + p.customer_id + p.customer_name + p.customer_email + p.clientId);
    return hmac256(p.serverKey, '/transaction/create/vaPOST' + raw);
}

function generateSignatureQRIS(p) {
    const raw = cleanValue(p.amount + p.expired + p.partner_reff + p.customer_id + p.customer_name + p.customer_email + p.clientId);
    return hmac256(p.serverKey, '/transaction/create/qrisPOST' + raw);
}

function normalizePhoneNumber(phoneNumber) {
    if (!phoneNumber) return null;
    let cleaned = phoneNumber.toString().replace(/\D/g, '');
    if (cleaned.startsWith('0')) cleaned = '62' + cleaned.substring(1);
    if (!cleaned.startsWith('62')) cleaned = '62' + cleaned;
    return cleaned;
}

function formatWhatsAppNumber(phoneNumber) {
    if (!phoneNumber) return null;
    let cleaned = normalizePhoneNumber(phoneNumber);
    return cleaned ? `whatsapp:${cleaned}` : null;
}

function formatRupiah(amount) {
    if (!amount) return 'Rp 0';
    return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(amount);
}

function parsePrice(price) {
    if (price === null || price === undefined) return 0;
    if (typeof price === 'number') return price;
    let priceStr = String(price).replace(/[Rr][Pp]\s*/g, '').replace(/[$,]/g, '').replace(/\./g, '').replace(/,/g, '.');
    const parsed = parseFloat(priceStr);
    return isNaN(parsed) ? 0 : parsed;
}

// ============================================================
// ADD BALANCE KE AKUN "amir"
// ============================================================
async function addBalanceToAmir(amount, customerName, methodCode, serialNumber) {
    const originalAmount = parseInt(amount);
    let admin = methodCode === 'QRIS' ? Math.round(originalAmount * 0.008) : 4000;
    const netAmount = originalAmount - admin;
    const username = 'amir';
    const note = `Pembayaran dari ${customerName} || Rp ${netAmount.toLocaleString('id-ID')} (admin ${admin.toLocaleString('id-ID')}) || ${methodCode} || Reff: ${serialNumber}`;

    console.log(`💰 [ADD-BALANCE] ${customerName} -> ${username} | Amount: ${netAmount} | Admin: ${admin}`);

    try {
        const response = await axios.post(`${CONFIG.jagelBaseUrl}/balance/adjust`, {
            action: 'adjust_balance',
            type: 'username',
            value: username,
            amount: netAmount,
            note: note,
            apikey: CONFIG.jagelApiKey
        }, { headers: { 'Content-Type': 'application/json' }, timeout: 30000 });

        console.log('✅ Balance added:', response.data);
        return { success: true, data: response.data };
    } catch (error) {
        console.error('❌ Add balance failed:', error.message);
        throw error;
    }
}

// Adjust saldo by phone number
async function adjustBalanceByPhone(phone, amount, note) {
    console.log(`💰 [ADJUST-BALANCE] phone: ${phone} | amount: ${amount}`);
    try {
        const response = await axios.post(`${CONFIG.jagelBaseUrl}/balance/adjust`, {
            type: 'phone',
            value: phone,
            amount: amount,
            note: note,
            apikey: CONFIG.jagelApiKey
        }, {
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'  // ← tambahkan ini
            },
            timeout: 30000
        });
        console.log(`✅ Balance adjusted:`, JSON.stringify(response.data));
        return { success: true, data: response.data };
    } catch (err) {
        // ← Ini yang paling penting untuk debug
        console.error(`❌ Adjust balance failed:`, err.message);
        console.error(`❌ Response status:`, err.response?.status);
        console.error(`❌ Response data:`, JSON.stringify(err.response?.data));
        console.error(`❌ Request payload:`, JSON.stringify({
            type: 'phone', value: phone, amount, apikey: CONFIG.jagelApiKey
        }));
        return { success: false, error: err.message };
    }
}

// ============================================================
// FUNGSI SETTLEMENT — dipanggil saat customer konfirmasi ATAU timeout 24 jam
// ============================================================
async function processOrderSettlement(order) {
    const orderId = order.order_id;
    console.log(`\n💰 [SETTLEMENT] Processing: ${orderId}`);

    // Cegah double settlement
    const [check] = await pool.execute(
        `SELECT order_status FROM orders WHERE order_id = ?`, [orderId]
    );
    if (check[0]?.order_status === 'COMPLETED') {
        console.log(`⚠️ [SETTLEMENT] Already completed, skip: ${orderId}`);
        return;
    }

    // ── Ubah partner_commission dari persen ke pembagi ────────────────────
    // Contoh: 10% → 1.10, 15% → 1.15, 20% → 1.20
    const partnerCommissionPersen = parseFloat(order.partner_commission) || 0;
    const partnerDivider = 1 + (partnerCommissionPersen / 100);  // 1.10 untuk 10%

    console.log(`   partner_comm    : ${partnerCommissionPersen}% → divider ${partnerDivider}`);

    // ── Hitung ongkir dan harga barang dari order_items ──────────────────
    let totalOngkir = 0;
    let totalHargaBarang = 0;

    if (order.order_items) {
        try {
            const orderItems = typeof order.order_items === 'string'
                ? JSON.parse(order.order_items)
                : order.order_items;

            if (Array.isArray(orderItems) && orderItems.length > 0) {
                for (const store of orderItems) {
                    const distance = parseFloat(store.distance || store.store?.distance || 0);
                    const ongkir = store.ongkir || (distance <= 3 ? 9500 : 9500 + Math.round((distance - 3) * 3500));
                    totalOngkir += ongkir;
                    for (const item of store.items || []) {
                        totalHargaBarang += (item.price || 0) * (item.qty || 1);
                    }
                }
            }
        } catch (e) {
            console.error('❌ Parse order_items error:', e.message);
        }
    }

    // Fallback ke kolom DB kalau order_items kosong/gagal parse
    if (totalOngkir === 0 && totalHargaBarang === 0) {
        console.warn(`⚠️ [SETTLEMENT] Fallback ke base_price & service_fee`);
        totalHargaBarang = parseInt(order.base_price) || 0;
        totalOngkir = parseInt(order.service_fee) || 0;
    }

    // ── Hitung bagian MITRA dengan PEMBAGI ────────────────────────────────
    // Mitra dapat = harga_produk ÷ (1 + partner_commission%)
    // Contoh: 100.000 ÷ 1,10 = 90.909 (mitra dapat setelah dipotong 10%)
    const mitraAmount = Math.round(totalHargaBarang / partnerDivider);
    const potonganMitra = totalHargaBarang - mitraAmount;

    // ── Hitung bagian DRIVER ─────────────────────────────────────────────
    // Driver dapat = ongkir - (ongkir × 8%)
    const potonganDriver = Math.round(totalOngkir * 0.08);
    const driverAmount = totalOngkir - potonganDriver;

    // ── Log ringkasan ────────────────────────────────────────────────────
    console.log(`   payment_method  : ${order.payment_method || '-'}`);
    console.log(`   harga_barang    : Rp ${totalHargaBarang.toLocaleString('id-ID')}`);
    console.log(`   partner_comm    : ${partnerCommissionPersen}% (÷${partnerDivider})`);
    console.log(`   MITRA DAPAT     : Rp ${mitraAmount.toLocaleString('id-ID')}`);
    console.log(`   potongan_mitra  : Rp ${potonganMitra.toLocaleString('id-ID')}`);
    console.log(`   ongkir          : Rp ${totalOngkir.toLocaleString('id-ID')}`);
    console.log(`   potongan_driver : Rp ${potonganDriver.toLocaleString('id-ID')} (8%)`);
    console.log(`   DRIVER DAPAT    : Rp ${driverAmount.toLocaleString('id-ID')}`);

    // ── Adjust saldo MITRA ───────────────────────────────────────────────
    if (order.mitra_phone && mitraAmount > 0) {
        const mitraNote = `Harga order ${orderId} | Produk ${formatRupiah(totalHargaBarang)} ÷ ${partnerDivider} = ${formatRupiah(mitraAmount)}`;
        const mitraResult = await adjustBalanceByPhone(
            formatPhoneDisplay(order.mitra_phone),
            mitraAmount,
            mitraNote
        );
        console.log(`✅ Mitra [${formatPhoneDisplay(order.mitra_phone)}]: ${mitraResult.success ? 'OK' : '❌ ' + mitraResult.error}`);
    } else {
        console.warn(`⚠️ Skip mitra: phone=${order.mitra_phone}, amount=${mitraAmount}`);
    }

    // ── Adjust saldo DRIVER ──────────────────────────────────────────────
    if (order.driver_phone && driverAmount > 0) {
        const driverNote = `Ongkir order ${orderId} | Ongkir ${formatRupiah(totalOngkir)} - 8% = ${formatRupiah(driverAmount)}`;
        const driverResult = await adjustBalanceByPhone(
            formatPhoneDisplay(order.driver_phone),
            driverAmount,
            driverNote
        );
        console.log(`✅ Driver [${formatPhoneDisplay(order.driver_phone)}]: ${driverResult.success ? 'OK' : '❌ ' + driverResult.error}`);
    } else {
        console.warn(`⚠️ Skip driver: phone=${order.driver_phone}, amount=${driverAmount}`);
    }

    // ── Update status COMPLETED ──────────────────────────────────────────
    await pool.execute(
        `UPDATE orders SET order_status = 'COMPLETED', updated_at = NOW() WHERE order_id = ?`,
        [orderId]
    );
    console.log(`✅ [SETTLEMENT] COMPLETED: ${orderId}`);
}
// ============================================================
// TWILIO SEND FUNCTIONS
// ============================================================
async function sendWhatsAppTemplate(to, templateSid, variables) {
    console.log(`\n📤 [SEND-TEMPLATE] Starting...`);
    console.log(` Original to: ${to}`);
    console.log(` Template SID: ${templateSid}`);

    if (!twilioClient) {
        console.error('❌ Twilio client not initialized!');
        return { success: false, error: 'Twilio not initialized' };
    }

    // ✅ NORMALISASI ULANG NOMOR (pastikan format whatsapp:62xxx)
    let normalizedNumber = normalizePhoneNumber(to);
    if (!normalizedNumber) {
        console.error(`❌ Invalid phone number: ${to}`);
        return { success: false, error: 'Invalid phone number' };
    }

    const whatsappTo = `whatsapp:${normalizedNumber}`;
    console.log(`📱 Formatted: ${to} -> ${whatsappTo}`);

    if (!templateSid || !templateSid.startsWith('HX')) {
        console.error(`❌ Invalid template SID: ${templateSid}`);
        return { success: false, error: 'Invalid template SID' };
    }

    try {
        const result = await twilioClient.messages.create({
            from: CONFIG.twilioWaNumber,
            to: whatsappTo,
            contentSid: templateSid,
            contentVariables: JSON.stringify(variables)
        });
        console.log(`✅ Template sent successfully! SID: ${result.sid}`);
        return { success: true, sid: result.sid };
    } catch (error) {
        console.error('❌ Twilio template error:', error.message);
        console.error(` To: ${whatsappTo}`);
        console.error(` Template: ${templateSid}`);
        return { success: false, error: error.message };
    }
}

async function sendWhatsAppFreeForm(to, message) {
    console.log(`\n📤 [SEND-FREE-FORM] Starting...`);
    console.log(` Original to: ${to}`);

    if (!twilioClient) {
        console.error('❌ Twilio client not initialized!');
        return { success: false, error: 'Twilio not initialized' };
    }

    // ✅ NORMALISASI ULANG NOMOR
    let normalizedNumber = normalizePhoneNumber(to);
    if (!normalizedNumber) {
        console.error(`❌ Invalid phone number: ${to}`);
        return { success: false, error: 'Invalid phone number' };
    }

    const whatsappTo = `whatsapp:${normalizedNumber}`;
    console.log(`📱 Formatted: ${to} -> ${whatsappTo}`);

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

// ============================================================
// DATABASE TEST
// ============================================================
let dbReady = false;
(async function testDb() {
    try {
        const conn = await pool.getConnection();
        console.log('✅ Database connected');
        conn.release();
        dbReady = true;
    } catch (err) {
        console.error('❌ Database connection failed:', err.message);
        dbReady = false;
    }
})();

// ============================================================
// CALL JAGEL API HELPER
// ============================================================
async function callJagelAppApi(url, bearerToken, method = 'GET', data = null) {
    const config = {
        method, url,
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

// ============================================================
// ENDPOINT: POST /create-va
// ============================================================
app.post('/create-va', async (req, res) => {
    console.log('\n📝 [CREATE-VA] Request:', JSON.stringify(req.body, null, 2));
    if (!dbReady) return res.status(503).json({ error: 'Database not ready' });

    try {
        const body = req.body;
        const customerId = body.customer_id || generateCustomerId();
        const partner_reff = generatePartnerReff();
        const expired = getExpiredTimestamp();
        const bankCode = body.bank_code || '008';

        const signature = generateSignatureVA({
            amount: body.amount, expired, bank_code: bankCode, partner_reff,
            customer_id: customerId, customer_name: body.customer_name,
            customer_email: body.customer_email, clientId: CONFIG.clientId, serverKey: CONFIG.serverKey
        });

        const payload = {
            amount: body.amount, bank_code: bankCode, customer_id: customerId,
            customer_name: body.customer_name, customer_email: body.customer_email,
            customer_phone: body.customer_phone || '', partner_reff, username: CONFIG.username,
            pin: CONFIG.pin, expired, signature, url_callback: CONFIG.callbackUrl,
            remark: `VA ${bankCode}`
        };

        const response = await axios.post(`${CONFIG.linkquGateway}/transaction/create/va`, payload, {
            headers: { 'client-id': CONFIG.clientId, 'client-secret': CONFIG.clientSecret }, timeout: 30000
        });

        const result = response.data;
        const vaNumber = result.virtual_account || null;
        const isSuccess = result.status === 'SUCCESS' || result.response_code === '00';

        await pool.execute(
            `INSERT INTO inquiry_va (partner_reff, customer_name, customer_phone, customer_email, bank_code, va_number, amount, expired, response_raw, created_at, status)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [partner_reff, body.customer_name, body.customer_phone || null, body.customer_email, bankCode, vaNumber, body.amount, expired, JSON.stringify(result), mysqlNow(), isSuccess ? 'PENDING' : 'FAILED']
        );

        res.json({ ...result, partner_reff, customer_id: customerId, db_saved: true });
    } catch (err) {
        console.error('❌ [CREATE-VA] Error:', err.message);
        res.status(500).json({ error: 'Failed to create VA', detail: err.message });
    }
});

// ============================================================
// ENDPOINT: POST /create-qris
// ============================================================
app.post('/create-qris', async (req, res) => {
    console.log('\n📝 [CREATE-QRIS] Request:', JSON.stringify(req.body, null, 2));
    if (!dbReady) return res.status(503).json({ error: 'Database not ready' });

    try {
        const body = req.body;
        const customerId = body.customer_id || generateCustomerId();
        const partner_reff = generatePartnerReff();
        const expired = getExpiredTimestamp();

        const signature = generateSignatureQRIS({
            amount: body.amount, expired, partner_reff, customer_id: customerId,
            customer_name: body.customer_name, customer_email: body.customer_email,
            clientId: CONFIG.clientId, serverKey: CONFIG.serverKey
        });

        const payload = {
            amount: body.amount, customer_id: customerId, customer_name: body.customer_name,
            customer_email: body.customer_email, customer_phone: body.customer_phone || '',
            partner_reff, username: CONFIG.username, pin: CONFIG.pin, expired, signature,
            url_callback: CONFIG.callbackUrl
        };

        const response = await axios.post(`${CONFIG.linkquGateway}/transaction/create/qris`, payload, {
            headers: { 'client-id': CONFIG.clientId, 'client-secret': CONFIG.clientSecret }, timeout: 30000
        });

        const result = response.data;
        let qrisImageBuffer = null;
        if (result?.imageqris) {
            try {
                const imgResp = await axios.get(result.imageqris.trim(), { responseType: 'arraybuffer', timeout: 10000 });
                qrisImageBuffer = Buffer.from(imgResp.data);
            } catch (imgErr) { console.warn('QR image download failed:', imgErr.message); }
        }

        const isSuccess = result.status === 'SUCCESS' || result.response_code === '00';

        await pool.execute(
            `INSERT INTO inquiry_qris (partner_reff, customer_id, customer_name, amount, expired, customer_phone, customer_email, qris_url, qris_image, response_raw, created_at, status)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [partner_reff, customerId, body.customer_name, body.amount, expired, body.customer_phone || null, body.customer_email, result?.imageqris || null, qrisImageBuffer, JSON.stringify(result), mysqlNow(), isSuccess ? 'PENDING' : 'FAILED']
        );

        res.json({ ...result, partner_reff, customer_id: customerId, db_saved: true });
    } catch (err) {
        console.error('❌ [CREATE-QRIS] Error:', err.message);
        res.status(500).json({ error: 'Failed to create QRIS', detail: err.message });
    }
});

// ============================================================
// ENDPOINT: GET /check-status/:partner_reff
// ============================================================
app.get('/check-status/:partner_reff', async (req, res) => {
    const { partner_reff } = req.params;

    console.log(`\n🔍 [CHECK-STATUS] Checking: ${partner_reff}`);

    if (!partner_reff) {
        return res.status(400).json({ rc: '01', message: 'partner_reff diperlukan' });
    }

    try {
        let transaction = null;

        let [rows] = await pool.execute(
            `SELECT partner_reff, status, amount, bank_code as method, created_at
FROM inquiry_va
WHERE partner_reff = ?`,
            [partner_reff]
        );

        if (rows.length > 0) {
            transaction = { ...rows[0], type: 'VA' };
        }

        if (!transaction) {
            [rows] = await pool.execute(
                `SELECT partner_reff, status, amount, created_at
FROM inquiry_qris
WHERE partner_reff = ?`,
                [partner_reff]
            );
            if (rows.length > 0) {
                transaction = { ...rows[0], type: 'QRIS', method: 'QRIS' };
            }
        }

        if (!transaction) {
            console.log(`❌ Transaction not found: ${partner_reff}`);
            return res.status(404).json({ rc: '404', message: 'Transaksi tidak ditemukan', data: null });
        }

        const status_trx = transaction.status === 'SUKSES' ? 'success' : 'pending';

        res.json({
            rc: '00', message: 'Success',
            data: { ...transaction, status_trx, checked_at: new Date().toISOString() }
        });
    } catch (err) {
        console.error('❌ [CHECK-STATUS] Error:', err.message);
        res.status(500).json({ rc: '99', message: 'Internal server error', error: err.message });
    }
});

// ============================================================
// ENDPOINT: POST /callback (PAYMENT CALLBACK - TAMBAH SALDO KE AMIR)
// ============================================================
app.post('/callback', async (req, res) => {
    console.log('\n📞 [CALLBACK] Received:', JSON.stringify(req.body, null, 2));

    const { partner_reff, serialnumber, status, transaction_status } = req.body;
    const finalPartnerReff = partner_reff || serialnumber;

    if (!finalPartnerReff) {
        console.error('❌ Missing partner_reff');
        return res.status(400).json({ error: 'partner_reff wajib ada' });
    }

    const connection = await pool.getConnection();
    let tableName = null;
    let dbData = null;

    try {
        await connection.beginTransaction();

        let [rows] = await connection.execute(
            `SELECT status, customer_name, amount, bank_code as method_code, 'VA' as type FROM inquiry_va WHERE partner_reff = ? FOR UPDATE`,
            [finalPartnerReff]
        );
        if (rows.length > 0) { tableName = 'inquiry_va'; dbData = rows[0]; }

        if (!tableName) {
            [rows] = await connection.execute(
                `SELECT status, customer_name, amount, 'QRIS' as method_code, 'QRIS' as type FROM inquiry_qris WHERE partner_reff = ? FOR UPDATE`,
                [finalPartnerReff]
            );
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

        const isPaid = status === 'SUCCESS' || status === 'SUKSES' || transaction_status === 'SUCCESS';

        if (isPaid) {
            await connection.execute(`UPDATE ${tableName} SET status = 'SUKSES' WHERE partner_reff = ?`, [finalPartnerReff]);
            await connection.commit();

            // ✅ Adjust saldo amir PENUH tanpa potongan
            const fullAmount = parseInt(dbData.amount);
            const note = `Pembayaran masuk dari ${dbData.customer_name} | ${dbData.method_code} | Reff: ${finalPartnerReff}`;
            await adjustBalanceByPhone(CONFIG.csNumber, fullAmount, note);
            console.log(`✅ Saldo amir +${fullAmount} (penuh)`);

            res.json({ success: true, message: 'Callback processed, saldo amir ditambahkan penuh' });
        } else {
            await connection.commit();
            res.json({ success: false, message: 'Payment not confirmed yet' });
        }
    } catch (err) {
        console.error(`❌ [CALLBACK] Error:`, err.message);
        try { await connection.rollback(); } catch (e) { }
        res.status(500).json({ error: 'Internal Server Error', detail: err.message });
    } finally {
        connection.release();
    }
});

// ============================================================
// ENDPOINT: GET /drivers (SSE for drivers)
// ============================================================
app.get('/drivers', async (req, res) => {
    const HARDCODED_TOKEN = "eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiIsImp0aSI6Ijg1Yzk4YmM3YzNmNDkxZDNiZmEzNjM5NjY2ZWZkNTdkNDk5OThiYTZlY2NiNDNiN2ZjYWMwZDkyMWY2YTdmYzJjZGVmN2UzOTE5MGE3MzM3In0.eyJhdWQiOiIxIiwianRpIjoiODVjOThiYzdjM2Y0OTFkM2JmYTM2Mzk2NjZlZmQ1N2Q0OTk5OGJhNmVjY2I0M2I3ZmNhYzBkOTIxZjZhN2ZjMmNkZWY3ZTM5MTkwYTczMzciLCJpYXQiOjE3ODEwMDg3MzgsIm5iZiI6MTc4MTAwODczOCwiZXhwIjoxODEyNTQ0NzM4LCJzdWIiOiIyOTcxODQ0Iiwic2NvcGVzIjpbXX0.v_zfEuEnychameQba8Uq2d0toIs2uSfr7WvzvHWnz1zZf1Ula7Hp_zKSp7KEzimn8paxYjDwtTI_JEBhqFuuE_xPqMQnFyl3P6ZmvUouOO3KtULk-Nw5kfSQbKv2g6e0UTrUkg18POeESzTbLGxJB62dbVtJAtxyNKt5SOhDbn7ezrqAZQAiBUByevBuYkNioRTRqH_tG9Z1a3thNwEqjr0tL2Lnz9g-b8pSIHOE4r68OQIEhXYRiVCItvbP9uxnhCh4_A2Vd_cmXMDBp05etIBI8Ns4BJpTo_7hxxtioJismhaPbRW8F4LMdNNAVTgMJSCAlSjv26iXHa-j-HYMkuhHHLnBN1j57GDOMUTI4uvv-w78pWFtVPoe06crXVT6lXJFICturkdbQS2gFZ3CQdHrp2DOS_XX7f57T9Tg9TXXLrDqKn_vI4qLo6-Jucnt5NF9kBdcYE6oXWDuOp806f8wllNeh1DE7C2PUSZF6E1WonzXGbBwjg-1kVgwn76zOJm3M5UzB4aWcUiTiLMTUjMl_lMcYCEzjDH4yPajyY8WMOqxCDZR1lKK5AEVp9YJSj3An1qut0QLQhF5xPl5b63EcRNzYfTm6C2OB4RHbJnRvXF_6qB3IqAi7qQS_7sjPcjzr1b-L9_VgVCKMoNu5CCQ2cEvm4ppEjejAEEqHbM";

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
            console.warn(`⚠️ Failed to fetch detail for ${view_uid}: ${err.message}`);
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

        console.log('[fetchDriversReport] payload:', JSON.stringify(payload));  // ← tambah ini
        console.log('[fetchDriversReport] token prefix:', finalToken.substring(0, 20) + '...');

        try {
            const response = await callJagelAppApi(REPORT_URL, finalToken, 'POST', payload);
            return response.data;
        } catch (err) {
            console.error(`❌ Failed to fetch report page ${pageNum}:`, err.message);
            console.error('❌ Response status:', err.response?.status);
            console.error('❌ Response data:', JSON.stringify(err.response?.data));  // ← ini penting
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
// ENDPOINT: POST /orders
// ============================================================
app.post('/orders', async (req, res) => {
    console.log('\n🛒 [ORDERS-CREATE] Request:', JSON.stringify(req.body, null, 2));
    if (!dbReady) return res.status(503).json({ error: 'Database not ready' });

    try {
        const body = req.body;
        if (!body.customer_name || !body.customer_phone) {
            return res.status(400).json({ success: false, error: 'customer_name dan customer_phone wajib diisi' });
        }

        const order_id = body.order_id || `ORD-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
        const now = mysqlNow();
        const parsedTotal = parsePrice(body.total_price || 0);

        let orderStatus = body.order_status || 'PENDING';
        if (body.payment_status === 'PAID' && orderStatus === 'PENDING') {
            orderStatus = 'SEARCHING';
        }

        let orderItemsJson = null;
        if (body.order_items) {
            try {
                const parsed = typeof body.order_items === 'string'
                    ? JSON.parse(body.order_items)
                    : body.order_items;
                orderItemsJson = JSON.stringify(parsed);
                console.log(`✅ order_items parsed: ${parsed.length} toko`);
            } catch (e) {
                console.warn('⚠️ order_items parse failed:', e.message);
                orderItemsJson = typeof body.order_items === 'string' ? body.order_items : null;
            }
        }

        await pool.execute(`
INSERT INTO orders (
    order_id, order_status, order_date, order_note, order_items,
    service_type, service_name, service_description,
    origin_address, origin_lat, origin_lng,
    destination_address, destination_lat, destination_lng,
    distance_km, estimated_duration_min,
    base_price, service_fee, discount, total_price,
    payment_method, payment_status, partner_reff,
    mitra_id, mitra_name, mitra_username, mitra_phone, partner_commission,
    driver_id, driver_name, driver_phone, driver_photo, driver_address, driver_lat, driver_lng,
    customer_name, customer_phone,
    created_at, updated_at
) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
`, [
            order_id, orderStatus, body.order_date || now, body.order_note || null, orderItemsJson,
            body.service_type || null, body.service_name || null, body.service_description || null,
            body.origin_address || null, body.origin_lat || null, body.origin_lng || null,
            body.destination_address || null, body.destination_lat || null, body.destination_lng || null,
            body.distance_km || null, body.estimated_duration_min || null,
            body.base_price || 0, body.service_fee || 0, body.discount || 0, parsedTotal,
            body.payment_method || null, body.payment_status || 'UNPAID', body.partner_reff || null,
            body.mitra_id || null, body.mitra_name || null,
            body.mitra_username || null,   // ← mitra_username
            body.mitra_phone || null,
            body.partner_commission || 0,  // ← partner_commission
            body.driver_id || null, body.driver_name || null, body.driver_phone || null,
            body.driver_photo || null, body.driver_address || null, body.driver_lat || null, body.driver_lng || null,
            body.customer_name, body.customer_phone, now, now
        ]);

        console.log(`✅ Order created: ${order_id} | mitra: ${body.mitra_username || '-'} | commission: ${body.partner_commission || 0}%`);
        res.status(201).json({ success: true, message: 'Order berhasil dibuat', order_id, order_status: orderStatus });
    } catch (err) {
        console.error('❌ [ORDERS-CREATE] Error:', err.message);
        res.status(500).json({ error: 'Gagal membuat order', detail: err.message });
    }
});

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
        const parsedLimit = Math.min(parseInt(limit) || 50, 1000);
        const parsedOffset = Math.max(parseInt(offset) || 0, 0);

        const query = `SELECT * FROM orders ${whereClause} ORDER BY created_at DESC LIMIT ${parsedLimit} OFFSET ${parsedOffset}`;
        const [results] = await pool.execute(query, values);

        res.json({ success: true, count: results.length, data: results });
    } catch (err) {
        console.error('❌ [ORDERS-LIST] Error:', err.message);
        res.status(500).json({ error: 'Gagal mengambil data orders', detail: err.message });
    }
});

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
// ENDPOINT: POST /driver-confirmation
// ============================================================
// ============================================================
// ENDPOINT: POST /driver-confirmation
// ============================================================
app.post('/driver-confirmation', async (req, res) => {
    console.log('\n📋 [DRIVER-CONFIRMATION] Request:', JSON.stringify(req.body, null, 2));

    const { order_id, driver_id, driver_name, driver_phone, customer_name, customer_phone, total_amount, jumlah_toko } = req.body;

    if (!order_id) {
        return res.status(400).json({ success: false, message: 'order_id wajib diisi' });
    }

    // ✅ NORMALISASI NOMOR - PASTIKAN FORMAT 62XXX
    const normalizedDriverPhone = normalizePhoneNumber(driver_phone);
    const normalizedCustomerPhone = normalizePhoneNumber(customer_phone);
    const parsedTotal = parsePrice(total_amount || 0);

    console.log(`📱 Driver phone original: ${driver_phone} -> normalized: ${normalizedDriverPhone}`);
    console.log(`📱 Customer phone original: ${customer_phone} -> normalized: ${normalizedCustomerPhone}`);

    try {
        const [existingOrder] = await pool.execute('SELECT id FROM orders WHERE order_id = ?', [order_id]);

        if (existingOrder.length === 0) {
            console.error(`❌ Order ${order_id} tidak ditemukan! Order harus dibuat terlebih dahulu via POST /orders`);
            return res.status(404).json({
                success: false,
                message: 'Order tidak ditemukan. Silakan buat order terlebih dahulu.',
                order_id: order_id
            });
        }

        // ✅ UPDATE driver info dengan nomor yang sudah dinormalisasi
        await pool.execute(`
UPDATE orders SET driver_id = ?, driver_name = ?, driver_phone = ?, updated_at = NOW() WHERE order_id = ?
`, [driver_id || null, driver_name || null, normalizedDriverPhone, order_id]);
        console.log(`✅ Driver assigned to ${order_id}`);

        // ✅ Simpan ke memory cache dengan nomor yang sudah dinormalisasi
        driverConfirmations.set(order_id, {
            driver_id, driver_name, driver_phone: normalizedDriverPhone,
            customer_name, customer_phone: normalizedCustomerPhone,
            total_amount: parsedTotal, jumlah_toko: jumlah_toko || 1,
            status: 'pending', timestamp: Date.now(), expiresAt: Date.now() + (3 * 60 * 1000)
        });

        // ✅ KIRIM WHATSAPP KE DRIVER - GUNAKAN NOMOR YANG SUDAH DINORMALISASI
        let whatsappSent = false;
        if (normalizedDriverPhone) {
            const variables = {
                "1": driver_name || 'Driver',
                "2": customer_name || 'Customer',
                "3": formatRupiah(parsedTotal),
                "4": String(jumlah_toko || 1)
            };

            console.log(`📤 Sending WhatsApp to driver: ${normalizedDriverPhone}`);
            const result = await sendWhatsAppTemplate(normalizedDriverPhone, CONFIG.templateDriverConfirmation, variables);
            whatsappSent = result.success;
            console.log(`📱 WhatsApp result: ${whatsappSent ? 'SENT' : 'FAILED'} - ${result.error || ''}`);
        } else {
            console.error(`❌ Cannot send WhatsApp: driver phone is invalid`);
        }

        res.json({ success: true, order_id, whatsapp_sent: whatsappSent });
    } catch (err) {
        console.error('❌ Error:', err.message);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ============================================================
// ENDPOINT: POST /send-whatsapp
// ============================================================
app.post('/send-whatsapp', async (req, res) => {
    console.log('\n📋 [SEND-WHATSAPP] Request:', JSON.stringify(req.body, null, 2));
    const { to, message, use_template, template_sid, variables } = req.body;

    let result;
    if (use_template && template_sid) {
        result = await sendWhatsAppTemplate(to, template_sid, variables || {});
    } else {
        result = await sendWhatsAppFreeForm(to, message);
    }

    res.json(result);
});

async function sendOrderDetailsToDriver(orderId, confirmation) {
    console.log(`📦 [SEND-ORDER-DETAILS] Order: ${orderId}`);
    try {
        const [orders] = await pool.execute('SELECT * FROM orders WHERE order_id = ?', [orderId]);
        if (orders.length === 0) { console.error(`❌ Order ${orderId} not found!`); return; }

        const order = orders[0];
        let storesDetailText = '-';

        if (order.order_items) {
            try {
                const orderItems = typeof order.order_items === 'string'
                    ? JSON.parse(order.order_items) : order.order_items;

                if (Array.isArray(orderItems) && orderItems.length > 0) {
                    const storeParts = [];
                    for (const store of orderItems) {
                        const storeName = store.name || store.store?.title || 'Toko';
                        const distance = parseFloat(store.distance || store.store?.distance || 0);
                        const ongkir = store.ongkir || (distance <= 3 ? 9500 : 9500 + Math.round((distance - 3) * 3500));
                        const items = store.items || [];
                        let subTotal = 0;
                        const itemLines = [];
                        for (const item of items) {
                            const itemPrice = item.price || 0;
                            const itemQty = item.qty || 1;
                            subTotal += itemPrice * itemQty;
                            itemLines.push(`${itemQty}x ${item.name} Rp${(itemPrice * itemQty).toLocaleString('id-ID')}`);
                        }
                        storeParts.push(
                            `[${storeName}] ${distance.toFixed(1)}km, ongkir Rp${ongkir.toLocaleString('id-ID')} | ` +
                            `${itemLines.join(', ')} | Subtotal Rp${subTotal.toLocaleString('id-ID')}`
                        );
                    }
                    storesDetailText = storeParts.join(' || ');
                }
            } catch (e) {
                storesDetailText = order.order_note || '-';
            }
        } else {
            storesDetailText = order.order_note || '-';
        }

        storesDetailText = storesDetailText.replace(/\r?\n|\r/g, ' ').trim();
        if (storesDetailText.length > 1500) storesDetailText = storesDetailText.substring(0, 1497) + '...';

        const customerPhoneDisplay = formatPhoneDisplay(order.customer_phone);

        // ── Ambil info mitra dari order ──
        const mitraUsername = order.mitra_name || order.mitra_id || '-';
        const mitraPhoneDisplay = order.mitra_phone ? formatPhoneDisplay(order.mitra_phone) : '-';

        // Ambil nama toko pertama dari order_items sebagai identitas mitra
        let mitraStoreName = '-';
        try {
            const orderItems = typeof order.order_items === 'string'
                ? JSON.parse(order.order_items) : order.order_items;
            if (Array.isArray(orderItems) && orderItems.length > 0) {
                mitraStoreName = orderItems[0]?.name || orderItems[0]?.store?.title || '-';
            }
        } catch (e) { }

        await sendWhatsAppTemplate(confirmation.driver_phone, CONFIG.templateDriverOrderAccepted, {
            "1": String(confirmation.driver_name || 'Driver'),
            "2": String(order.customer_name || '-'),
            "3": String(customerPhoneDisplay),
            "4": String(orderId),
            "5": String(storesDetailText),
            "6": String(formatRupiah(order.total_price)),
            "7": String(mitraStoreName),  // ← nama toko, bukan username
            "8": String(mitraPhoneDisplay)
        });

        // PESAN 2: Link rute Google Maps
        const originLat = order.origin_lat;
        const originLng = order.origin_lng;
        const destLat = order.destination_lat;
        const destLng = order.destination_lng;

        if (originLat && originLng && destLat && destLng) {
            const linkKeToko = `https://www.google.com/maps/dir/?api=1&destination=${originLat},${originLng}&travelmode=driving`;
            const linkKeCustomer = `https://www.google.com/maps/dir/?api=1&origin=${originLat},${originLng}&destination=${destLat},${destLng}&travelmode=driving`;

            const routeMsg =
                `🗺️ *RUTE PENGANTARAN*\n\n` +
                `📍 *1. Menuju Toko:*\n` +
                `${order.origin_address || 'Alamat toko'}\n` +
                `${linkKeToko}\n\n` +
                `🏠 *2. Menuju Customer:*\n` +
                `${order.destination_address || 'Alamat customer'}\n` +
                `${linkKeCustomer}`;
            await new Promise(r => setTimeout(r, 1000));
            await sendWhatsAppFreeForm(confirmation.driver_phone, routeMsg);
            console.log(`✅ Route links sent to driver`);
        } else {
            console.warn(`⚠️ Koordinat tidak lengkap, skip kirim rute`);
        }

        // PESAN 3: Notifikasi ke mitra
        await notifyMitraNewOrder(orderId, order, confirmation);

        // PESAN 4: Template quick reply "Pesanan Selesai" — dikirim setelah 5 menit
        const DELAY_MS = 5 * 60 * 1000;
        const scheduledAt = Date.now() + DELAY_MS;

        pendingCompletions.set(orderId, {
            driver_phone: confirmation.driver_phone,
            customer_phone: order.customer_phone,
            customer_name: order.customer_name,
            driver_name: confirmation.driver_name,
            scheduled_at: scheduledAt,
            completion_sent: false,
            status: 'waiting'
        });

        setTimeout(async () => {
            const pending = pendingCompletions.get(orderId);
            if (!pending || pending.status !== 'waiting') return;

            console.log(`⏰ [COMPLETION-PROMPT] Sending to driver after 5 min: ${orderId}`);
            try {
                await sendWhatsAppTemplate(pending.driver_phone, CONFIG.templateDriverOrderComplete, {
                    "1": String(pending.driver_name || 'Driver'),
                    "2": String(orderId)
                });
                pending.completion_sent = true;
                pendingCompletions.set(orderId, pending);
                console.log(`✅ Completion prompt sent to driver for order ${orderId}`);
            } catch (err) {
                console.error(`❌ Failed to send completion prompt:`, err.message);
            }
        }, DELAY_MS);

        console.log(`✅ Order details sent to driver, mitra notified, completion prompt scheduled in 5 min`);
    } catch (error) {
        console.error(`❌ Error sendOrderDetailsToDriver:`, error.message);
    }
}

// ============================================================
// FUNGSI NOTIFIKASI KE MITRA
// ============================================================
async function notifyMitraNewOrder(orderId, order, confirmation) {
    console.log(`📧 [NOTIFY-MITRA] Order: ${orderId}`);

    if (!order.mitra_phone) {
        console.warn(`⚠️ Mitra phone tidak ada, skip notifikasi mitra`);
        return;
    }

    try {
        // Hitung komisi mitra
        const partnerCommission = order.partner_commission || 0;
        const totalPrice = order.total_price || 0;
        const komisiNominal = Math.round(totalPrice * (partnerCommission / 100));

        const driverPhoneDisplay = formatPhoneDisplay(confirmation.driver_phone);
        const mitraUsername = order.mitra_name || order.mitra_id || 'Mitra';

        // Buat ringkasan pesanan singkat untuk mitra
        let orderSummary = '-';
        if (order.order_items) {
            try {
                const orderItems = typeof order.order_items === 'string'
                    ? JSON.parse(order.order_items) : order.order_items;
                if (Array.isArray(orderItems) && orderItems.length > 0) {
                    const parts = [];
                    for (const store of orderItems) {
                        const storeName = store.name || store.store?.title || 'Toko';
                        const items = store.items || [];
                        const itemNames = items.map(i => `${i.qty || 1}x ${i.name}`).join(', ');
                        parts.push(`${storeName}: ${itemNames}`);
                    }
                    orderSummary = parts.join(' | ');
                }
            } catch (e) {
                orderSummary = order.order_note || '-';
            }
        }

        orderSummary = orderSummary.replace(/\r?\n|\r/g, ' ').trim();
        if (orderSummary.length > 500) orderSummary = orderSummary.substring(0, 497) + '...';

        // Ambil nama toko dari order_items
        let mitraStoreName = '-';
        try {
            const orderItems = typeof order.order_items === 'string'
                ? JSON.parse(order.order_items) : order.order_items;
            if (Array.isArray(orderItems) && orderItems.length > 0) {
                mitraStoreName = orderItems[0]?.name || orderItems[0]?.store?.title || '-';
            }
        } catch (e) { }

        await sendWhatsAppTemplate(order.mitra_phone, CONFIG.templateMitraOrderNotify, {
            "1": String(mitraStoreName),          // ← nama toko
            "2": String(orderId),
            "3": String(order.customer_name || '-'),
            "4": String(orderSummary),
            "5": String(formatRupiah(totalPrice)),
            "6": String(confirmation.driver_name || 'Driver'),
            "7": String(driverPhoneDisplay)
            // hapus variabel komisi {{8}} dan {{9}}
        });

        console.log(`✅ Mitra notified: ${order.mitra_phone}`);
    } catch (err) {
        console.error(`❌ Error notifyMitraNewOrder:`, err.message);
    }
}
// ============================================================
// FUNGSI CEK APAKAH MASIH DALAM JAM OPERASIONAL (sebelum 00.00 WIT)
// WIT = UTC+9
// ============================================================
function isWithinOperationalHours() {
    const now = new Date();
    const witHour = (now.getUTCHours() + 9) % 24;
    // Aktif dari jam 00.01 sampai 23.59 WIT
    // Blokir hanya jam 0 (00.00 - 00.59) atau sesuaikan batasnya
    return witHour >= 6 && witHour < 24; // contoh: aktif jam 06.00 - 23.59 WIT
}

// ============================================================
// WEBHOOK WHATSAPP (UPDATED — handle tombol SELESAI & SUDAH)
// ============================================================
app.post('/webhook/whatsapp', express.urlencoded({ extended: true }), async (req, res) => {
    console.log('\n📨 [WEBHOOK] Received:', JSON.stringify(req.body, null, 2));

    const messageBody = req.body.Body || req.body.body;
    const fromNumber = req.body.From || req.body.from;
    const buttonPayload = req.body.ButtonPayload;

    if (!messageBody && !buttonPayload) return res.sendStatus(400);

    const rawDriverPhone = fromNumber.replace('whatsapp:', '');
    const driverPhone = normalizePhoneNumber(rawDriverPhone);
    const message = (buttonPayload || messageBody || '').trim().toUpperCase();

    console.log(`📱 From: ${driverPhone}, Message: ${message}`);

    // ── HANDLE: Driver klik "PESANAN SELESAI" ──────────────────────────────
    if (message === 'PESANAN_SELESAI' || message === 'ORDER_COMPLETE') {
        let matchedOrderId = null;
        let matchedPending = null;

        for (const [orderId, pending] of pendingCompletions) {
            if (normalizePhoneNumber(pending.driver_phone) === driverPhone
                && pending.status === 'waiting'
                && pending.completion_sent === true) {
                matchedOrderId = orderId;
                matchedPending = pending;
                break;
            }
        }

        if (!matchedOrderId || !matchedPending) {
            console.warn(`⚠️ No pending completion found for driver ${driverPhone}`);
            await sendWhatsAppFreeForm(rawDriverPhone, '⚠️ Tidak ada pesanan aktif yang menunggu konfirmasi selesai.');
            return res.sendStatus(200);
        }

        // Update status order ke DELIVERED
        matchedPending.status = 'completed';
        pendingCompletions.set(matchedOrderId, matchedPending);

        await pool.execute(
            `UPDATE orders SET order_status = 'DELIVERED', updated_at = NOW() WHERE order_id = ?`,
            [matchedOrderId]
        );
        console.log(`✅ Order ${matchedOrderId} marked as DELIVERED`);

        await sendWhatsAppFreeForm(rawDriverPhone, `✅ Terima kasih! Pesanan *${matchedOrderId}* telah ditandai selesai.`);

        // Kirim template konfirmasi ke customer — hanya jika masih dalam jam operasional
        try {
            await sendWhatsAppTemplate(
                normalizePhoneNumber(matchedPending.customer_phone),
                CONFIG.templateCustomerOrderReceived,
                {
                    "1": String(matchedPending.customer_name || 'Pelanggan'),
                    "2": String(matchedOrderId)
                }
            );
            console.log(`✅ Customer confirmation template sent for order ${matchedOrderId}`);
        } catch (err) {
            console.error(`❌ Failed to send customer confirmation:`, err.message);
        }

        return res.sendStatus(200);
    }

    // ── HANDLE: Customer klik "SUDAH TERIMA" ──────────────────────────────
    // ============================================================
    // WEBHOOK WHATSAPP — handler SUDAH_TERIMA (FIXED)
    // ============================================================

    if (message === 'SUDAH_TERIMA' || message === 'ORDER_RECEIVED') {

        // Ambil 8 digit terakhir — paling toleran terhadap perbedaan format
        const phoneSuffix = driverPhone.replace(/\D/g, '').slice(-10);

        const [rows] = await pool.execute(
            `SELECT * FROM orders 
             WHERE customer_phone LIKE ? 
             AND order_status = 'DELIVERED' 
             ORDER BY updated_at DESC 
             LIMIT 1`,
            [`%${phoneSuffix}%`]
        );

        if (rows.length === 0) {
            console.warn(`⚠️ No delivered order for customer ${driverPhone} (suffix: ${phoneSuffix})`);
            await sendWhatsAppFreeForm(rawDriverPhone, '⚠️ Pesanan tidak ditemukan atau belum berstatus DELIVERED.');
            return res.sendStatus(200);
        }

        const order = rows[0];
        console.log(`✅ Found order: ${order.order_id} for settlement`);

        await sendWhatsAppFreeForm(rawDriverPhone, `Terima kasih! Pesanan *${order.order_id}* telah dikonfirmasi sebagai selesai.`);

        try {
            await processOrderSettlement(order);
        } catch (err) {
            console.error(`❌ Settlement FAILED:`, err.message);
        }

        return res.sendStatus(200);
    }


    // ── HANDLE: Accept / Reject driver (kode lama) ─────────────────────────
    let foundOrderId = null;
    let foundConfirmation = null;

    for (const [orderId, confirmation] of driverConfirmations) {
        if (confirmation.driver_phone === driverPhone && confirmation.status === 'pending') {
            foundOrderId = orderId;
            foundConfirmation = confirmation;
            break;
        }
    }

    if (foundOrderId && foundConfirmation && (message === 'ACCEPT' || message === 'TERIMA' || message === 'YES')) {
        foundConfirmation.status = 'accepted';
        driverConfirmations.set(foundOrderId, foundConfirmation);
        await pool.execute(`UPDATE orders SET order_status = 'CONFIRMED', updated_at = NOW() WHERE order_id = ?`, [foundOrderId]);
        console.log(`✅ Order ${foundOrderId} confirmed`);
        await sendWhatsAppFreeForm(rawDriverPhone, '✅ Terima kasih! Pesanan telah dikonfirmasi.');
        await sendOrderDetailsToDriver(foundOrderId, foundConfirmation);
        await notifyCustomerOrderAccepted(foundOrderId, foundConfirmation);

    } else if (foundOrderId && foundConfirmation && (message === 'REJECT' || message === 'TOLAK' || message === 'NO')) {
        foundConfirmation.status = 'rejected';
        driverConfirmations.set(foundOrderId, foundConfirmation);
        await pool.execute(`UPDATE orders SET order_status = 'CANCELLED', updated_at = NOW() WHERE order_id = ?`, [foundOrderId]);
        await sendWhatsAppFreeForm(rawDriverPhone, '❌ Pesanan ditolak.');
    }

    res.sendStatus(200);
});

async function notifyCustomerOrderAccepted(orderId, confirmation) {
    console.log(`📧 [NOTIFY-CUSTOMER] Order: ${orderId}`);
    try {
        const [orders] = await pool.execute('SELECT * FROM orders WHERE order_id = ?', [orderId]);
        if (orders.length === 0) { console.error(`❌ Order ${orderId} not found!`); return; }

        const order = orders[0];
        let storesDetailText = '-';

        if (order.order_items) {
            try {
                const orderItems = typeof order.order_items === 'string'
                    ? JSON.parse(order.order_items) : order.order_items;

                if (Array.isArray(orderItems) && orderItems.length > 0) {
                    const storeParts = [];

                    for (const store of orderItems) {
                        const storeName = store.name || store.store?.title || 'Toko';
                        const distance = parseFloat(store.distance || store.store?.distance || 0);
                        const ongkir = store.ongkir || (distance <= 3 ? 9500 : 9500 + Math.round((distance - 3) * 3500));
                        const items = store.items || [];

                        let subTotal = 0;
                        const itemLines = [];
                        for (const item of items) {
                            const itemPrice = item.price || 0;
                            const itemQty = item.qty || 1;
                            subTotal += itemPrice * itemQty;
                            itemLines.push(`${itemQty}x ${item.name} Rp${(itemPrice * itemQty).toLocaleString('id-ID')}`);
                        }

                        storeParts.push(
                            `[${storeName}] ${distance.toFixed(1)}km, ongkir Rp${ongkir.toLocaleString('id-ID')} | ` +
                            `${itemLines.join(', ')} | Subtotal Rp${subTotal.toLocaleString('id-ID')}`
                        );
                    }

                    storesDetailText = storeParts.join(' || ');
                }
            } catch (e) {
                console.error('Parse error:', e.message);
                storesDetailText = order.order_note || '-';
            }
        } else {
            storesDetailText = order.order_note || '-';
        }

        // ✅ FINAL SAFETY: strip semua newline
        storesDetailText = storesDetailText.replace(/\r?\n|\r/g, ' ').trim();
        if (storesDetailText.length > 1500) storesDetailText = storesDetailText.substring(0, 1497) + '...';

        const driverPhoneDisplay = formatPhoneDisplay(confirmation.driver_phone);

        const variables = {
            "1": String(order.customer_name || '-'),
            "2": String(confirmation.driver_name || 'Driver'),
            "3": String(driverPhoneDisplay),
            "4": String(orderId),
            "5": String(storesDetailText),
            "6": String(formatRupiah(order.total_price))
        };

        console.log(`📤 [CUSTOMER] Variables["5"] =`, variables["5"]);

        await sendWhatsAppTemplate(order.customer_phone, CONFIG.templateCustomerOrderConfirmed, variables);
        console.log(`✅ Customer notified`);
    } catch (error) {
        console.error(`❌ Error notifyCustomerOrderAccepted:`, error.message);
    }
}
// ============================================================
// ENDPOINT: GET /check-confirmation/:orderId
// ============================================================
app.get('/check-confirmation/:orderId', async (req, res) => {
    const { orderId } = req.params;
    const confirmation = driverConfirmations.get(orderId);

    if (confirmation) {
        if (confirmation.status === 'pending' && Date.now() > confirmation.expiresAt) {
            confirmation.status = 'timeout';
            driverConfirmations.set(orderId, confirmation);
        }
        res.json({ status: confirmation.status, driver_name: confirmation.driver_name, driver_phone: confirmation.driver_phone });
    } else {
        const [rows] = await pool.execute('SELECT order_status, driver_name, driver_phone FROM orders WHERE order_id = ?', [orderId]);
        if (rows.length > 0 && rows[0].order_status === 'CONFIRMED') {
            res.json({ status: 'accepted', driver_name: rows[0].driver_name, driver_phone: rows[0].driver_phone });
        } else {
            res.json({ status: 'not_found' });
        }
    }
});

// ============================================================
// ENDPOINT: GET /health
// ============================================================
app.get('/health', (req, res) => {
    res.json({
        status: 'OK',
        timestamp: new Date().toISOString(),
        database_ready: dbReady,
        twilio_ready: !!twilioClient,
        uptime: process.uptime()
    });
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
                    let parsedTotal = confirmation.total_amount || 21000;
                    if (typeof parsedTotal === 'string') {
                        parsedTotal = parseInt(parsedTotal.replace(/\D/g, '')) || 21000;
                    }

                    await pool.execute(`
INSERT INTO orders (order_id, order_status, order_date, customer_name, customer_phone,
total_price, payment_status, driver_id, driver_name, driver_phone, created_at, updated_at)
VALUES (?, 'CONFIRMED', ?, ?, ?, ?, 'PAID', ?, ?, ?, NOW(), NOW())
ON DUPLICATE KEY UPDATE
driver_id = VALUES(driver_id), driver_name = VALUES(driver_name),
driver_phone = VALUES(driver_phone), order_status = 'CONFIRMED', updated_at = NOW()
`, [orderId, now, confirmation.customer_name, confirmation.customer_phone || '6282323907426',
                        parsedTotal, confirmation.driver_id, confirmation.driver_name, confirmation.driver_phone]);
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
// DEBUG: Cek isi template Twilio
// ============================================================
app.get('/debug/template/:sid', async (req, res) => {
    const { sid } = req.params;
    try {
        const template = await twilioClient.content.v1.contents(sid).fetch();
        res.json({
            sid: template.sid,
            friendly_name: template.friendlyName,
            types: template.types,
            variables: template.variables
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Endpoint manual settle — hapus setelah dipakai
app.post('/debug/manual-settle/:order_id', async (req, res) => {
    const { order_id } = req.params;
    const [rows] = await pool.execute('SELECT * FROM orders WHERE order_id = ?', [order_id]);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });

    try {
        await processOrderSettlement(rows[0]);
        res.json({ success: true, order_id });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// START SERVER
// ============================================================
const PORT = CONFIG.port;
app.listen(PORT, () => {
    console.log(`\n========================================`);
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📍 URL: http://localhost:${PORT}`);
    console.log(`========================================`);
    console.log(`\n✅ Endpoints ready:`);
    console.log(` POST /create-va`);
    console.log(` POST /create-qris`);
    console.log(` GET /check-status/:partner_reff`);
    console.log(` POST /callback`);
    console.log(` GET /drivers`);
    console.log(` POST /orders`);
    console.log(` GET /orders`);
    console.log(` GET /orders/:order_id`);
    console.log(` PUT /orders/:order_id`);
    console.log(` POST /driver-confirmation`);
    console.log(` POST /send-whatsapp`);
    console.log(` POST /webhook/whatsapp`);
    console.log(` GET /check-confirmation/:orderId`);
    console.log(` GET /health`);
    console.log(` GET /debug/driver-confirmations`);
    console.log(` POST /fix-all-missing-orders`);
    console.log(`\n📱 Driver confirmation flow is READY!\n`);
});