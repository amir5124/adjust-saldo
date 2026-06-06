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
app.use(express.urlencoded({ extended: true }));

// ============================================================
// KONFIGURASI
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
    jagelApiKey: process.env.JAGEL_APIKEY || 'q2t7lktZkZIEiCDs7y9HpWP0WCRdABEGTrHidEUhrAMe0IDzXV',
    linkquGateway: process.env.LINKQU_GATEWAY || 'https://gateway-dev.linkqu.id/linkqu-partner',
    jagelBaseUrl: process.env.JAGEL_BASE_URL || 'https://api.jagel.id/v1',
    port: parseInt(process.env.PORT || '3000'),

    // Twilio Configuration
    twilioSid: process.env.TWILIO_ACCOUNT_SID || '',
    twilioAuth: process.env.TWILIO_AUTH_TOKEN || '',
    twilioWaNumber: process.env.TWILIO_WHATSAPP_NUMBER || 'whatsapp:+14155238886',
    csNumber: process.env.CS_PHONE_NUMBER || '6282226666610',

    // Twilio Template SIDs
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

// ============================================================
// TWILIO SEND FUNCTIONS
// ============================================================
async function sendWhatsAppTemplate(to, templateSid, variables) {
    if (!twilioClient) return { success: false, error: 'Twilio not initialized' };
    const whatsappTo = formatWhatsAppNumber(to);
    if (!whatsappTo) return { success: false, error: 'Invalid phone number' };
    try {
        const result = await twilioClient.messages.create({
            from: CONFIG.twilioWaNumber,
            to: whatsappTo,
            contentSid: templateSid,
            contentVariables: JSON.stringify(variables)
        });
        return { success: true, sid: result.sid };
    } catch (error) {
        console.error('❌ Twilio error:', error.message);
        return { success: false, error: error.message };
    }
}

async function sendWhatsAppFreeForm(to, message) {
    if (!twilioClient) return { success: false, error: 'Twilio not initialized' };
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

        // Cek di inquiry_va
        let [rows] = await connection.execute(
            `SELECT status, customer_name, amount, bank_code as method_code, 'VA' as type FROM inquiry_va WHERE partner_reff = ? FOR UPDATE`,
            [finalPartnerReff]
        );
        if (rows.length > 0) {
            tableName = 'inquiry_va';
            dbData = rows[0];
        }

        // Cek di inquiry_qris
        if (!tableName) {
            [rows] = await connection.execute(
                `SELECT status, customer_name, amount, 'QRIS' as method_code, 'QRIS' as type FROM inquiry_qris WHERE partner_reff = ? FOR UPDATE`,
                [finalPartnerReff]
            );
            if (rows.length > 0) {
                tableName = 'inquiry_qris';
                dbData = rows[0];
            }
        }

        if (!tableName || !dbData) {
            await connection.rollback();
            console.error(`❌ Transaction not found: ${finalPartnerReff}`);
            return res.status(404).json({ error: 'Data transaksi tidak ditemukan' });
        }

        // Cek status pembayaran (SUCCESS/SUKSES/PAID)
        const isPaid = status === 'SUCCESS' || status === 'SUKSES' || transaction_status === 'SUCCESS' || dbData.status === 'SUKSES';

        if (dbData.status === 'SUKSES') {
            await connection.rollback();
            console.log(`ℹ️ Already processed: ${finalPartnerReff}`);
            return res.json({ message: 'Sudah diproses sebelumnya.' });
        }

        if (isPaid) {
            // Update status di database
            await connection.execute(`UPDATE ${tableName} SET status = 'SUKSES' WHERE partner_reff = ?`, [finalPartnerReff]);
            await connection.commit();
            console.log(`✅ Payment confirmed for ${finalPartnerReff}`);

            // TAMBAH SALDO KE AKUN AMIR
            const methodCode = dbData.method_code === 'QRIS' ? 'QRIS' : 'VA';
            await addBalanceToAmir(dbData.amount, dbData.customer_name, methodCode, finalPartnerReff);

            console.log(`🎉 Saldo ditambahkan ke akun amir: Rp ${dbData.amount} dari ${dbData.customer_name}`);
            res.json({ success: true, message: 'Callback processed, balance added to amir' });
        } else {
            await connection.commit();
            console.log(`ℹ️ Payment not confirmed yet for ${finalPartnerReff}`);
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
// ENDPOINT: POST /orders
// ============================================================
const VALID_ORDER_STATUSES = ['PENDING', 'SEARCHING', 'CONFIRMED', 'PICKED_UP', 'ON_THE_WAY', 'ARRIVED', 'COMPLETED', 'CANCELLED', 'FAILED'];
const VALID_PAYMENT_STATUSES = ['UNPAID', 'PAID', 'REFUNDED', 'FAILED'];

app.post('/orders', async (req, res) => {
    console.log('\n🛒 [ORDERS-CREATE] Request:', JSON.stringify(req.body, null, 2));
    try {
        const body = req.body;
        if (!body.customer_name || !body.customer_phone) {
            return res.status(400).json({ success: false, error: 'customer_name dan customer_phone wajib diisi' });
        }

        const order_id = `ORD-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
        const now = mysqlNow();
        const parsedTotal = parsePrice(body.total_price || 0);

        const [dbResult] = await pool.execute(
            `INSERT INTO orders (order_id, order_status, order_date, customer_name, customer_phone, total_price, payment_status, created_at, updated_at)
             VALUES (?, 'PENDING', NOW(), ?, ?, ?, 'UNPAID', NOW(), NOW())`,
            [order_id, body.customer_name, body.customer_phone, parsedTotal]
        );

        res.status(201).json({ success: true, message: 'Order berhasil dibuat', order_id, insert_id: dbResult.insertId });
    } catch (err) {
        console.error('❌ [ORDERS-CREATE] Error:', err.message);
        res.status(500).json({ error: 'Gagal membuat order', detail: err.message });
    }
});

app.get('/orders', async (req, res) => {
    try {
        const [results] = await pool.query(`SELECT * FROM orders ORDER BY created_at DESC LIMIT 100`);
        res.json({ success: true, count: results.length, data: results });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/orders/:order_id', async (req, res) => {
    try {
        const [rows] = await pool.execute('SELECT * FROM orders WHERE order_id = ?', [req.params.order_id]);
        if (!rows.length) return res.status(404).json({ success: false, message: 'Order tidak ditemukan' });
        res.json({ success: true, data: rows[0] });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/orders/:order_id', async (req, res) => {
    try {
        const { order_id } = req.params;
        const { order_status, driver_id, driver_name, driver_phone } = req.body;

        const [result] = await pool.execute(
            `UPDATE orders SET order_status = ?, driver_id = ?, driver_name = ?, driver_phone = ?, updated_at = NOW() WHERE order_id = ?`,
            [order_status || 'CONFIRMED', driver_id || null, driver_name || null, driver_phone || null, order_id]
        );

        if (result.affectedRows === 0) return res.status(404).json({ success: false, message: 'Order tidak ditemukan' });
        res.json({ success: true, message: 'Order berhasil diupdate', order_id });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// ENDPOINT: POST /driver-confirmation
// ============================================================
app.post('/driver-confirmation', async (req, res) => {
    console.log('\n📋 [DRIVER-CONFIRMATION] Request:', JSON.stringify(req.body, null, 2));

    const { order_id, driver_id, driver_name, driver_phone, customer_name, customer_phone, total_amount, jumlah_toko } = req.body;

    if (!order_id) {
        return res.status(400).json({ success: false, message: 'order_id wajib diisi' });
    }

    const normalizedDriverPhone = driver_phone ? normalizePhoneNumber(driver_phone) : null;
    const normalizedCustomerPhone = customer_phone ? normalizePhoneNumber(customer_phone) : null;
    const parsedTotal = parsePrice(total_amount || 0);

    try {
        const [existingOrder] = await pool.execute('SELECT id FROM orders WHERE order_id = ?', [order_id]);

        if (existingOrder.length === 0) {
            // Buat order baru jika belum ada
            await pool.execute(
                `INSERT INTO orders (order_id, order_status, customer_name, customer_phone, total_price, payment_status, created_at, updated_at)
                 VALUES (?, 'PENDING', ?, ?, ?, 'UNPAID', NOW(), NOW())`,
                [order_id, customer_name || 'Customer', normalizedCustomerPhone, parsedTotal]
            );
            console.log(`✅ Order ${order_id} created`);
        }

        // Update driver info
        await pool.execute(
            `UPDATE orders SET driver_id = ?, driver_name = ?, driver_phone = ?, updated_at = NOW() WHERE order_id = ?`,
            [driver_id || null, driver_name || null, normalizedDriverPhone, order_id]
        );
        console.log(`✅ Driver assigned to ${order_id}`);

        // Simpan ke memory cache
        driverConfirmations.set(order_id, {
            driver_id, driver_name, driver_phone: normalizedDriverPhone,
            customer_name, customer_phone: normalizedCustomerPhone,
            total_amount: parsedTotal, jumlah_toko: jumlah_toko || 1,
            status: 'pending', timestamp: Date.now(), expiresAt: Date.now() + (3 * 60 * 1000)
        });

        // Kirim WhatsApp ke driver
        let whatsappSent = false;
        if (driver_phone) {
            const result = await sendWhatsAppTemplate(driver_phone, CONFIG.templateDriverConfirmation, {
                "1": driver_name || 'Driver',
                "2": customer_name || 'Customer',
                "3": formatRupiah(parsedTotal),
                "4": String(jumlah_toko || 1)
            });
            whatsappSent = result.success;
        }

        res.json({ success: true, order_id, whatsapp_sent: whatsappSent });
    } catch (err) {
        console.error('❌ Error:', err.message);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ============================================================
// WEBHOOK WHATSAPP
// ============================================================
app.post('/webhook/whatsapp', async (req, res) => {
    console.log('\n📨 [WEBHOOK] Received:', JSON.stringify(req.body, null, 2));

    const messageBody = req.body.Body || req.body.body;
    const fromNumber = req.body.From || req.body.from;
    const buttonPayload = req.body.ButtonPayload;

    if (!messageBody && !buttonPayload) return res.sendStatus(400);

    const rawDriverPhone = fromNumber.replace('whatsapp:', '');
    const driverPhone = normalizePhoneNumber(rawDriverPhone);
    const message = (buttonPayload || messageBody || '').trim().toUpperCase();

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

    if (foundOrderId && foundConfirmation && (message === 'ACCEPT' || message === 'TERIMA' || message === 'YES')) {
        foundConfirmation.status = 'accepted';
        driverConfirmations.set(foundOrderId, foundConfirmation);

        await pool.execute(`UPDATE orders SET order_status = 'CONFIRMED', updated_at = NOW() WHERE order_id = ?`, [foundOrderId]);
        console.log(`✅ Order ${foundOrderId} confirmed`);

        await sendWhatsAppFreeForm(rawDriverPhone, '✅ Terima kasih! Pesanan telah dikonfirmasi.');

        const [order] = await pool.execute('SELECT customer_name, customer_phone, total_price FROM orders WHERE order_id = ?', [foundOrderId]);
        if (order.length) {
            await sendWhatsAppTemplate(order[0].customer_phone, CONFIG.templateCustomerOrderConfirmed, {
                "1": order[0].customer_name,
                "2": foundConfirmation.driver_name,
                "3": driverPhone,
                "4": foundOrderId,
                "5": "Pesanan Anda sedang diproses oleh driver",
                "6": formatRupiah(order[0].total_price)
            });
        }
    } else if (foundOrderId && foundConfirmation && (message === 'REJECT' || message === 'TOLAK' || message === 'NO')) {
        foundConfirmation.status = 'rejected';
        driverConfirmations.set(foundOrderId, foundConfirmation);
        await pool.execute(`UPDATE orders SET order_status = 'CANCELLED', updated_at = NOW() WHERE order_id = ?`, [foundOrderId]);
        await sendWhatsAppFreeForm(rawDriverPhone, '❌ Pesanan ditolak.');
    }

    res.sendStatus(200);
});

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
// START SERVER
// ============================================================
const PORT = CONFIG.port;
app.listen(PORT, () => {
    console.log(`\n========================================`);
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📍 URL: http://localhost:${PORT}`);
    console.log(`========================================\n`);
});